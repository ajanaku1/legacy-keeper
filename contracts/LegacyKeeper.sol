// SPDX-License-Identifier: MIT
pragma solidity 0.8.24; // pinned, not floating

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title LegacyKeeper
 * @notice Onchain inheritance and emergency evacuation, executed by a keeper
 *         (KeeperHub) rather than by the owner.
 *
 * Design notes that differ from a naive implementation, and why:
 *
 * 1. CUSTODY. The owner keeps their assets. This contract holds ERC-20
 *    *allowances*, never balances, and pulls with transferFrom at execution
 *    time. A product that protects your wallet must not require you to empty
 *    it into an unaudited contract first. Native ETH cannot be pulled, so it
 *    is opt-in via deposit and is the secondary path.
 *
 * 2. AUTHORITY. executeInheritance() is permissionless and gated on elapsed
 *    time. The owner is by definition absent when it must run, so restricting
 *    it to the owner would make the feature impossible.
 *
 * 3. SIGNATURES. Every authorization is EIP-712 typed data bound to chainId,
 *    this contract's address, an action-specific typehash, a nonce, and a
 *    deadline. One leaked signature must not drain a second deployment, and a
 *    signature for one action must not authorize another.
 *
 * 4. LIVENESS. Delivery uses push with a pull fallback. A beneficiary that
 *    reverts on receive() must not be able to brick the whole estate.
 */
contract LegacyKeeper {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct Beneficiary {
        address wallet;
        uint16 shareBps; // basis points; all beneficiaries must total 10000
    }

    struct LivenessConfig {
        uint64 heartbeatInterval;
        uint64 timeoutDuration;
        uint64 gracePeriod;
        uint64 lastHeartbeat;
        bool livenessActive;
    }

    struct VaultConfig {
        address safeVault;
        address recoveryKeyAddress;
        bool recoveryKeyRegistered;
        bool privateRoutingEnabled;
    }

    // ──────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────

    uint16 public constant TOTAL_BPS = 10000;

    /// @dev A liveness proof cannot be spammed more than once per day.
    uint256 private constant HEARTBEAT_COOLDOWN = 1 days;

    /// @dev Gas forwarded to a beneficiary on push. Enough for a plain
    ///      receive(), too little to reenter, and caps griefing cost.
    uint256 private constant PUSH_GAS = 30000;

    /// @dev Caps the evacuate() sweep loop. The emergency path must never be
    ///      made unrunnable by a long token list.
    uint256 public constant MAX_TRACKED_TOKENS = 32;

    /// @dev Bounds the distribution loop so an estate cannot be configured
    ///      into a state where executing it exceeds the block gas limit.
    uint256 public constant MAX_BENEFICIARIES = 10;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant HEARTBEAT_TYPEHASH =
        keccak256("Heartbeat(uint256 nonce,uint256 deadline)");
    bytes32 private constant EVACUATE_TYPEHASH =
        keccak256("Evacuate(uint256 nonce,uint256 deadline)");
    bytes32 private constant PANIC_TYPEHASH =
        keccak256("Panic(uint256 nonce,uint256 deadline)");
    bytes32 private constant ROTATE_RECOVERY_TYPEHASH =
        keccak256("RotateRecoveryKey(address newKey,uint256 nonce,uint256 deadline)");
    bytes32 private constant SET_VAULT_TYPEHASH =
        keccak256("SetSafeVault(address newVault,uint256 nonce,uint256 deadline)");
    bytes32 private constant SET_BENEFICIARIES_TYPEHASH =
        keccak256("SetBeneficiaries(bytes32 beneficiariesHash,uint256 nonce,uint256 deadline)");
    bytes32 private constant SET_LIVENESS_CONFIG_TYPEHASH = keccak256(
        "SetLivenessConfig(uint64 heartbeatInterval,uint64 timeoutDuration,uint64 gracePeriod,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SET_RECOVERY_CONFIG_TYPEHASH = keccak256(
        "SetRecoveryConfig(address recoveryKey,address safeVault,bool allowSharedRecovery,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SET_TRACKED_TOKENS_TYPEHASH =
        keccak256("SetTrackedTokens(bytes32 tokensHash,uint256 nonce,uint256 deadline)");

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    address public owner;
    /// @dev Two-step handover. A stolen key must not be able to lock the real
    ///      owner out in one transaction, and ERC-20 allowances point at the
    ///      current owner — an unacknowledged handover would silently break
    ///      token distribution.
    address public pendingOwner;

    LivenessConfig public liveness;
    VaultConfig public vault;

    Beneficiary[] public beneficiaries;
    mapping(address => bool) public isBeneficiary;
    mapping(address => uint256) private beneficiaryIndex;
    uint16 public totalShareBps;

    address[] public trackedTokens;
    mapping(address => bool) public isTrackedToken;

    /// @dev Shared across every action, so a nonce burned by a panic cannot
    ///      be replayed into an evacuation.
    mapping(uint256 => bool) public nonceUsed;

    /// @dev Configuration actions use independent nonce spaces. Nonce 7 for
    ///      beneficiaries does not block nonce 7 for liveness, while the
    ///      action-specific typehash still prevents cross-action replay.
    mapping(bytes32 => mapping(uint256 => bool)) public actionNonceUsed;

    /// @dev Pull fallback for pushes that fail.
    mapping(address => uint256) public pendingWithdrawal;

    /// @dev One distribution per token, mirroring the native path's idempotency.
    mapping(address => bool) public tokenDistributed;

    /// @dev token => beneficiary => amount owed after a failed delivery.
    ///      Blocklisted recipients are real (USDC, USDT); one frozen address
    ///      must not strand everyone else's share.
    mapping(address => mapping(address => uint256)) public pendingTokenWithdrawal;

    bool public inheritanceExecuted;
    bool public evacuationExecuted;
    uint64 public inheritanceTimestamp;
    uint64 public evacuationTimestamp;
    bool public initialized;

    uint256 private _locked = 1;
    address private immutable _initializer;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event HeartbeatRecorded(address indexed sender, uint64 timestamp);
    event GracePeriodEntered(uint64 deadline);
    event InheritanceExecuted(address indexed executedBy, uint64 timestamp);
    event InheritanceTransfer(address indexed beneficiary, address indexed token, uint256 amount);
    event DeliveryDeferred(address indexed beneficiary, uint256 amount);
    event Withdrawn(address indexed beneficiary, uint256 amount);
    event EvacuationTriggered(address indexed executedBy, uint64 timestamp);
    event EvacuationTransfer(address indexed token, uint256 amount);
    event PanicButtonPressed(address indexed executedBy, uint64 timestamp);
    event BeneficiaryAdded(address indexed wallet, uint16 shareBps);
    event BeneficiaryRemoved(address indexed wallet, uint16 shareBps);
    event TrackedTokensUpdated(uint256 count);
    event RecoveryKeyRegistered(address indexed recoveryKey);
    event RecoveryKeyRotated(address indexed from, address indexed to);
    event OwnershipTransferProposed(address indexed from, address indexed to);
    event TokenDeliveryDeferred(address indexed token, address indexed beneficiary, uint256 amount);
    event ConfigUpdated(string key);

    // ──────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "LK: not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "LK: reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "LK: invalid owner");
        owner = initialOwner;
        _initializer = msg.sender;
        liveness = LivenessConfig({
            heartbeatInterval: 1 days,
            timeoutDuration: 30 days,
            gracePeriod: 7 days,
            lastHeartbeat: uint64(block.timestamp),
            livenessActive: true
        });
        vault = VaultConfig({
            safeVault: address(0),
            recoveryKeyAddress: address(0),
            recoveryKeyRegistered: false,
            privateRoutingEnabled: true
        });
    }

    /// @notice One-time factory bootstrap. Every field is already bound into
    ///         the owner's signed CreatePlan config hash at the factory.
    function initializePlan(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_,
        address[] calldata beneficiaryWallets,
        uint16[] calldata beneficiaryShares,
        address recoveryKey,
        address safeVault,
        address[] calldata tokens,
        bool allowSharedRecovery
    ) external {
        require(msg.sender == _initializer, "LK: not initializer");
        require(!initialized, "LK: already initialized");
        initialized = true;

        _setLivenessConfig(heartbeatInterval_, timeoutDuration_, gracePeriod_);
        _replaceBeneficiaries(beneficiaryWallets, beneficiaryShares);
        _setRecoveryConfig(recoveryKey, safeVault, allowSharedRecovery);
        _replaceTrackedTokens(tokens);
    }

    // ──────────────────────────────────────────────
    // Liveness
    // ──────────────────────────────────────────────

    /// @notice Refresh liveness directly. Cheapest path when the owner has gas.
    function heartbeat() external onlyOwner {
        require(liveness.livenessActive, "LK: liveness inactive");
        _requireHeartbeatCooldown();
        _recordHeartbeat(msg.sender);
    }

    /**
     * @notice Refresh liveness via a relayed signature, so KeeperHub can
     *         sponsor the gas. The owner signs typed data over a nonce and a
     *         deadline — both knowable at signing time, unlike a block
     *         timestamp.
     */
    function heartbeatBySig(uint256 nonce, uint256 deadline, bytes calldata signature) external {
        require(liveness.livenessActive, "LK: liveness inactive");
        _consumeSignature(HEARTBEAT_TYPEHASH, nonce, deadline, signature, owner);
        _requireHeartbeatCooldown();
        _recordHeartbeat(owner);
    }

    function _requireHeartbeatCooldown() private view {
        require(
            block.timestamp >= uint256(liveness.lastHeartbeat) + HEARTBEAT_COOLDOWN,
            "LK: heartbeat cooldown"
        );
    }

    function _recordHeartbeat(address who) private {
        liveness.lastHeartbeat = uint64(block.timestamp);
        emit HeartbeatRecorded(who, uint64(block.timestamp));
    }

    /// @notice Owner cancels a pending inheritance by proving liveness.
    function cancelInheritance() external onlyOwner {
        require(!inheritanceExecuted, "LK: already executed");
        require(liveness.livenessActive, "LK: liveness inactive");
        _recordHeartbeat(msg.sender);
    }

    // ──────────────────────────────────────────────
    // Inheritance
    // ──────────────────────────────────────────────

    /**
     * @notice Distribute native ETH held by this contract to beneficiaries.
     * @dev Permissionless by design — KeeperHub calls this. Safety comes from
     *      the elapsed-time gate, not from who is asking.
     */
    function executeInheritance() external nonReentrant {
        _assertInheritanceReady();

        // EFFECTS before INTERACTIONS. inheritanceExecuted alone prevents a
        // re-run; livenessActive stays true so the ERC-20 leg can still run.
        inheritanceExecuted = true;
        inheritanceTimestamp = uint64(block.timestamp);

        uint256 balance = address(this).balance;
        uint256 len = beneficiaries.length;

        for (uint256 i = 0; i < len; i++) {
            Beneficiary memory b = beneficiaries[i];
            uint256 amount = (balance * b.shareBps) / TOTAL_BPS;
            if (amount == 0) continue;
            _deliver(b.wallet, amount);
            emit InheritanceTransfer(b.wallet, address(0), amount);
        }

        emit InheritanceExecuted(msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Distribute an ERC-20 the owner still holds in their own wallet,
     *         pulled by allowance at execution time.
     * @dev Separate from the native path so gas stays bounded per token and
     *      one failing token cannot block the others.
     */
    function executeInheritanceERC20(address token) external nonReentrant {
        require(isTrackedToken[token], "LK: token not tracked");
        require(!tokenDistributed[token], "LK: token already distributed");
        _assertInheritanceReadyForTokens();

        uint256 available = _pullable(token);
        require(available > 0, "LK: nothing to distribute");

        tokenDistributed[token] = true;

        uint256 len = beneficiaries.length;
        for (uint256 i = 0; i < len; i++) {
            Beneficiary memory b = beneficiaries[i];
            uint256 amount = (available * b.shareBps) / TOTAL_BPS;
            if (amount == 0) continue;

            // Mirrors the native pull-fallback. A blocklisted or frozen
            // recipient records a claim instead of reverting the batch.
            if (_safeTransferFrom(token, owner, b.wallet, amount)) {
                emit InheritanceTransfer(b.wallet, token, amount);
            } else {
                pendingTokenWithdrawal[token][b.wallet] += amount;
                emit TokenDeliveryDeferred(token, b.wallet, amount);
            }
        }
    }

    /// @notice Retry a token share whose automatic delivery failed.
    function claimToken(address token) external nonReentrant {
        uint256 amount = pendingTokenWithdrawal[token][msg.sender];
        require(amount > 0, "LK: nothing pending");
        pendingTokenWithdrawal[token][msg.sender] = 0;
        require(
            _safeTransferFrom(token, owner, msg.sender, amount),
            "LK: token transfer failed"
        );
        emit InheritanceTransfer(msg.sender, token, amount);
    }

    function _assertInheritanceReady() private view {
        require(!inheritanceExecuted, "LK: already executed");
        _assertInheritanceReadyForTokens();
    }

    /// @dev Token distribution follows the native execution, so it shares the
    ///      gate but permits running after inheritanceExecuted is set.
    function _assertInheritanceReadyForTokens() private view {
        // Evacuation is checked first: it also clears livenessActive, and
        // "already evacuated" tells the caller far more than "inactive".
        require(!evacuationExecuted, "LK: already evacuated");
        // An owner who paused liveness has opted out. Without this the pause
        // switch is decorative and a paused estate still distributes.
        require(liveness.livenessActive, "LK: liveness inactive");
        require(beneficiaries.length > 0, "LK: no beneficiaries");
        require(totalShareBps == TOTAL_BPS, "LK: shares incomplete");
        (, bool graceElapsed) = getTimeoutStatus();
        require(graceElapsed, "LK: not yet due");
    }

    // ──────────────────────────────────────────────
    // Emergency evacuation
    // ──────────────────────────────────────────────

    /**
     * @notice Sweep assets to the safe vault, authorized by the recovery key.
     *         The wallet key may be fully compromised; it is never consulted.
     */
    function evacuate(uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        require(vault.recoveryKeyRegistered, "LK: recovery key not set");
        require(vault.safeVault != address(0), "LK: vault not configured");
        require(!evacuationExecuted, "LK: already evacuated");

        _consumeSignature(EVACUATE_TYPEHASH, nonce, deadline, signature, vault.recoveryKeyAddress);

        evacuationExecuted = true;
        evacuationTimestamp = uint64(block.timestamp);
        liveness.livenessActive = false;

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool sent, ) = payable(vault.safeVault).call{value: balance}("");
            require(sent, "LK: evacuation failed");
            emit EvacuationTransfer(address(0), balance);
        }

        uint256 len = trackedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            address token = trackedTokens[i];
            uint256 amount = _pullable(token);
            if (amount == 0) continue;
            // A token that reverts or returns false is skipped, never allowed
            // to block the sweep of everything else. evacuateToken() retries.
            if (_safeTransferFrom(token, owner, vault.safeVault, amount)) {
                emit EvacuationTransfer(token, amount);
            }
        }

        emit EvacuationTriggered(msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Sweep a single token after an evacuation, for anything the batch
     *         loop skipped or that arrived later. Keeps the emergency path
     *         recoverable without depending on one large transaction.
     */
    function evacuateToken(address token) external nonReentrant {
        require(evacuationExecuted, "LK: not evacuated");
        require(isTrackedToken[token], "LK: token not tracked");

        uint256 amount = _pullable(token);
        require(amount > 0, "LK: nothing to sweep");
        require(
            _safeTransferFrom(token, owner, vault.safeVault, amount),
            "LK: token transfer failed"
        );
        emit EvacuationTransfer(token, amount);
    }

    /**
     * @notice Signal a panic without moving funds, so an offchain workflow can
     *         react. Carries its own typehash: a panic signature can never be
     *         escalated into an evacuation.
     */
    function panicButton(uint256 nonce, uint256 deadline, bytes calldata signature) external {
        require(vault.recoveryKeyRegistered, "LK: recovery key not set");
        _consumeSignature(PANIC_TYPEHASH, nonce, deadline, signature, vault.recoveryKeyAddress);
        emit PanicButtonPressed(msg.sender, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────
    // Delivery
    // ──────────────────────────────────────────────

    /// @dev Push with a capped gas stipend; on failure credit a pull balance
    ///      so one hostile beneficiary cannot strand everyone else's share.
    function _deliver(address to, uint256 amount) private {
        (bool sent, ) = payable(to).call{value: amount, gas: PUSH_GAS}("");
        if (!sent) {
            pendingWithdrawal[to] += amount;
            emit DeliveryDeferred(to, amount);
        }
    }

    /**
     * @dev transferFrom that tolerates non-standard ERC-20s. USDT and friends
     *      return no data at all, so a plain IERC20 call reverts on the bool
     *      decode — which would make the single most likely inheritance asset
     *      impossible to transfer.
     */
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        // Three shapes must be handled: no return data (USDT), a clean bool,
        // and malformed data too short to decode. Decoding fewer than 32 bytes
        // reverts, which would take the whole distribution down with it.
        if (!ok) return false;
        if (data.length == 0) return true;
        if (data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    /// @notice Claim a share whose automatic delivery failed.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawal[msg.sender];
        require(amount > 0, "LK: nothing pending");
        pendingWithdrawal[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "LK: withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    // Signature verification
    // ──────────────────────────────────────────────

    function _consumeSignature(
        bytes32 typehash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) private {
        require(block.timestamp <= deadline, "LK: signature expired");
        require(!nonceUsed[nonce], "LK: nonce used");
        nonceUsed[nonce] = true;

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(typehash, nonce, deadline))
            )
        );

        require(_recover(digest, signature) == expectedSigner, "LK: invalid signature");
    }

    /// @dev Same as _consumeSignature with one address bound into the struct.
    function _consumeAddressSignature(
        bytes32 typehash,
        address subject,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) private {
        require(block.timestamp <= deadline, "LK: signature expired");
        require(!nonceUsed[nonce], "LK: nonce used");
        nonceUsed[nonce] = true;

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(typehash, subject, nonce, deadline))
            )
        );
        require(_recover(digest, signature) == expectedSigner, "LK: invalid signature");
    }

    function _consumeHashedActionSignature(
        bytes32 typehash,
        bytes32 payloadHash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) private {
        bytes32 structHash = keccak256(
            abi.encode(typehash, payloadHash, nonce, deadline)
        );
        _consumeActionDigest(
            typehash,
            nonce,
            deadline,
            structHash,
            signature,
            expectedSigner
        );
    }

    function _consumeLivenessConfigSignature(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) private {
        bytes32 structHash = keccak256(
            abi.encode(
                SET_LIVENESS_CONFIG_TYPEHASH,
                heartbeatInterval_,
                timeoutDuration_,
                gracePeriod_,
                nonce,
                deadline
            )
        );
        _consumeActionDigest(
            SET_LIVENESS_CONFIG_TYPEHASH,
            nonce,
            deadline,
            structHash,
            signature,
            owner
        );
    }

    function _consumeRecoveryConfigSignature(
        address recoveryKey,
        address safeVault,
        bool allowSharedRecovery,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) private {
        bytes32 structHash = keccak256(
            abi.encode(
                SET_RECOVERY_CONFIG_TYPEHASH,
                recoveryKey,
                safeVault,
                allowSharedRecovery,
                nonce,
                deadline
            )
        );
        _consumeActionDigest(
            SET_RECOVERY_CONFIG_TYPEHASH,
            nonce,
            deadline,
            structHash,
            signature,
            expectedSigner
        );
    }

    function _consumeActionDigest(
        bytes32 typehash,
        uint256 nonce,
        uint256 deadline,
        bytes32 structHash,
        bytes calldata signature,
        address expectedSigner
    ) private {
        require(block.timestamp <= deadline, "LK: signature expired");
        require(!actionNonceUsed[typehash][nonce], "LK: action nonce used");
        actionNonceUsed[typehash][nonce] = true;

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), structHash)
        );
        require(_recover(digest, signature) == expectedSigner, "LK: invalid signature");
    }

    /// @dev Binds every signature to this chain and this deployment.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("LegacyKeeper")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        require(signature.length == 65, "LK: bad sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // Reject the malleable upper-range s, per EIP-2.
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "LK: malleable signature"
        );
        require(v == 27 || v == 28, "LK: bad sig v");

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "LK: invalid signer");
        return signer;
    }

    // ──────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────

    function addBeneficiary(address wallet, uint16 shareBps) external onlyOwner {
        _addBeneficiary(wallet, shareBps);
    }

    function _addBeneficiary(address wallet, uint16 shareBps) private {
        require(wallet != address(0), "LK: invalid wallet");
        require(!isBeneficiary[wallet], "LK: already beneficiary");
        require(beneficiaries.length < MAX_BENEFICIARIES, "LK: too many beneficiaries");
        // Bound shareBps first so an oversized value reverts with a readable
        // reason instead of panicking on uint16 overflow in the sum below.
        require(shareBps > 0 && shareBps <= TOTAL_BPS, "LK: invalid share");
        require(totalShareBps + shareBps <= TOTAL_BPS, "LK: shares exceed 100%");

        beneficiaryIndex[wallet] = beneficiaries.length;
        beneficiaries.push(Beneficiary(wallet, shareBps));
        isBeneficiary[wallet] = true;
        totalShareBps += shareBps;

        emit BeneficiaryAdded(wallet, shareBps);
    }

    /// @notice Atomically replace the full allocation through an owner-signed
    ///         KeeperHub action. Partial totals never become live state.
    function setBeneficiariesBySig(
        address[] calldata wallets,
        uint16[] calldata shares,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        bytes32 beneficiariesHash = keccak256(abi.encode(wallets, shares));
        _consumeHashedActionSignature(
            SET_BENEFICIARIES_TYPEHASH,
            beneficiariesHash,
            nonce,
            deadline,
            signature,
            owner
        );
        _replaceBeneficiaries(wallets, shares);
    }

    function _replaceBeneficiaries(
        address[] calldata wallets,
        uint16[] calldata shares
    ) private {
        _validateBeneficiaries(wallets, shares);
        _clearBeneficiaries();
        uint256 len = wallets.length;
        for (uint256 i = 0; i < len; i++) {
            _addBeneficiary(wallets[i], shares[i]);
        }
    }

    function _clearBeneficiaries() private {
        uint256 existing = beneficiaries.length;
        for (uint256 i = 0; i < existing; i++) {
            Beneficiary memory removed = beneficiaries[i];
            delete beneficiaryIndex[removed.wallet];
            isBeneficiary[removed.wallet] = false;
            emit BeneficiaryRemoved(removed.wallet, removed.shareBps);
        }
        delete beneficiaries;
        totalShareBps = 0;
    }

    function _validateBeneficiaries(
        address[] calldata wallets,
        uint16[] calldata shares
    ) private pure {
        uint256 len = wallets.length;
        require(len > 0, "LK: no beneficiaries");
        require(len == shares.length, "LK: beneficiary length mismatch");
        require(len <= MAX_BENEFICIARIES, "LK: too many beneficiaries");

        uint256 total;
        for (uint256 i = 0; i < len; i++) {
            require(wallets[i] != address(0), "LK: invalid wallet");
            require(shares[i] > 0 && shares[i] <= TOTAL_BPS, "LK: invalid share");
            total += shares[i];
            for (uint256 j = 0; j < i; j++) {
                require(wallets[j] != wallets[i], "LK: duplicate beneficiary");
            }
        }
        require(total == TOTAL_BPS, "LK: shares incomplete");
    }

    /// @dev Swap-and-pop: the entry actually leaves the array, so a removed
    ///      beneficiary cannot be paid by the distribution loop.
    function removeBeneficiary(address wallet) external onlyOwner {
        require(isBeneficiary[wallet], "LK: not beneficiary");

        uint256 idx = beneficiaryIndex[wallet];
        uint256 last = beneficiaries.length - 1;
        uint16 removedShare = beneficiaries[idx].shareBps;

        if (idx != last) {
            Beneficiary memory moved = beneficiaries[last];
            beneficiaries[idx] = moved;
            beneficiaryIndex[moved.wallet] = idx;
        }

        beneficiaries.pop();
        delete beneficiaryIndex[wallet];
        isBeneficiary[wallet] = false;
        totalShareBps -= removedShare;

        emit BeneficiaryRemoved(wallet, removedShare);
    }

    /// @notice Register the ERC-20s to pull by allowance at execution time.
    function setTrackedTokens(address[] calldata tokens) external onlyOwner {
        _replaceTrackedTokens(tokens);
    }

    function setTrackedTokensBySig(
        address[] calldata tokens,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        bytes32 tokensHash = keccak256(abi.encode(tokens));
        _consumeHashedActionSignature(
            SET_TRACKED_TOKENS_TYPEHASH,
            tokensHash,
            nonce,
            deadline,
            signature,
            owner
        );
        _replaceTrackedTokens(tokens);
    }

    function _replaceTrackedTokens(address[] calldata tokens) private {
        require(tokens.length <= MAX_TRACKED_TOKENS, "LK: too many tokens");

        uint256 existing = trackedTokens.length;
        for (uint256 i = 0; i < existing; i++) {
            isTrackedToken[trackedTokens[i]] = false;
        }
        delete trackedTokens;

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            require(token != address(0), "LK: invalid token");
            if (isTrackedToken[token]) continue;
            isTrackedToken[token] = true;
            trackedTokens.push(token);
        }

        emit TrackedTokensUpdated(trackedTokens.length);
    }

    /**
     * @notice Set the evacuation destination.
     * @dev Owner-only until a recovery key exists. After that it needs the
     *      recovery key, because redirecting the vault is equivalent to
     *      stealing: a compromised owner key could otherwise point evacuation
     *      at the attacker and sweep the estate using the very mechanism meant
     *      to defend against them.
     */
    function setSafeVault(address vaultAddress) external onlyOwner {
        require(!vault.recoveryKeyRegistered, "LK: use setSafeVaultBySig");
        require(vaultAddress != address(0), "LK: invalid vault");
        require(vaultAddress != owner, "LK: vault must differ from owner");
        vault.safeVault = vaultAddress;
        emit ConfigUpdated("safe_vault");
    }

    /// @notice Change the vault with the recovery key's authorisation.
    function setSafeVaultBySig(
        address vaultAddress,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(vault.recoveryKeyRegistered, "LK: recovery key not set");
        require(vaultAddress != address(0), "LK: invalid vault");
        require(vaultAddress != owner, "LK: vault must differ from owner");
        require(
            vaultAddress != vault.recoveryKeyAddress,
            "LK: shared recovery requires config signature"
        );
        _consumeAddressSignature(
            SET_VAULT_TYPEHASH, vaultAddress, nonce, deadline,
            signature, vault.recoveryKeyAddress
        );
        vault.safeVault = vaultAddress;
        emit ConfigUpdated("safe_vault");
    }

    /// @notice First registration only. Rotation requires the current key.
    function registerRecoveryKey(address recoveryKey) external onlyOwner {
        require(!vault.recoveryKeyRegistered, "LK: use rotateRecoveryKey");
        require(recoveryKey != address(0), "LK: invalid recovery key");
        require(recoveryKey != owner, "LK: recovery must differ from owner");
        require(
            recoveryKey != vault.safeVault,
            "LK: shared recovery requires config signature"
        );
        vault.recoveryKeyAddress = recoveryKey;
        vault.recoveryKeyRegistered = true;
        emit RecoveryKeyRegistered(recoveryKey);
    }

    /**
     * @notice Rotate the recovery key, authorised by the CURRENT recovery key.
     * @dev Deliberately not owner-callable. The whole premise of Mode B is that
     *      it survives a compromised wallet key; if that key could re-point the
     *      recovery key, the emergency path would defend against nobody.
     */
    function rotateRecoveryKey(
        address newKey,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(vault.recoveryKeyRegistered, "LK: recovery key not set");
        require(newKey != address(0), "LK: invalid recovery key");
        require(newKey != owner, "LK: recovery must differ from owner");
        require(
            newKey != vault.safeVault,
            "LK: shared recovery requires config signature"
        );

        _consumeAddressSignature(
            ROTATE_RECOVERY_TYPEHASH, newKey, nonce, deadline,
            signature, vault.recoveryKeyAddress
        );

        emit RecoveryKeyRotated(vault.recoveryKeyAddress, newKey);
        vault.recoveryKeyAddress = newKey;
    }

    /// @notice Configure both recovery addresses in one reviewed action. The
    ///         owner signs first registration; the current recovery key signs
    ///         every later change so a compromised owner cannot redirect it.
    function setRecoveryConfigBySig(
        address recoveryKey,
        address safeVault,
        bool allowSharedRecovery,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        address expectedSigner = vault.recoveryKeyRegistered
            ? vault.recoveryKeyAddress
            : owner;
        _consumeRecoveryConfigSignature(
            recoveryKey,
            safeVault,
            allowSharedRecovery,
            nonce,
            deadline,
            signature,
            expectedSigner
        );
        _setRecoveryConfig(recoveryKey, safeVault, allowSharedRecovery);
    }

    function _setRecoveryConfig(
        address recoveryKey,
        address safeVault,
        bool allowSharedRecovery
    ) private {
        require(recoveryKey != address(0), "LK: invalid recovery key");
        require(safeVault != address(0), "LK: invalid vault");
        require(recoveryKey != owner, "LK: recovery must differ from owner");
        require(safeVault != owner, "LK: vault must differ from owner");
        require(
            recoveryKey != safeVault || allowSharedRecovery,
            "LK: shared recovery not acknowledged"
        );

        address previous = vault.recoveryKeyAddress;
        vault.recoveryKeyAddress = recoveryKey;
        vault.recoveryKeyRegistered = true;
        vault.safeVault = safeVault;

        if (previous == address(0)) {
            emit RecoveryKeyRegistered(recoveryKey);
        } else if (previous != recoveryKey) {
            emit RecoveryKeyRotated(previous, recoveryKey);
        }
        emit ConfigUpdated("safe_vault");
    }

    function setLivenessConfig(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_
    ) external onlyOwner {
        _setLivenessConfig(heartbeatInterval_, timeoutDuration_, gracePeriod_);
    }

    function setLivenessConfigBySig(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _consumeLivenessConfigSignature(
            heartbeatInterval_,
            timeoutDuration_,
            gracePeriod_,
            nonce,
            deadline,
            signature
        );
        _setLivenessConfig(heartbeatInterval_, timeoutDuration_, gracePeriod_);
    }

    function _setLivenessConfig(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_
    ) private {
        require(heartbeatInterval_ > 0, "LK: invalid heartbeat interval");
        require(timeoutDuration_ > 0, "LK: invalid timeout");
        liveness.heartbeatInterval = heartbeatInterval_;
        liveness.timeoutDuration = timeoutDuration_;
        liveness.gracePeriod = gracePeriod_;
        emit ConfigUpdated("liveness_config");
    }

    function toggleLiveness(bool active) external onlyOwner {
        liveness.livenessActive = active;
        emit ConfigUpdated("liveness_active");
    }

    /// @notice Step 1 of 2. Nothing changes until the recipient accepts.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LK: invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner);
    }

    /// @notice Step 2 of 2, called by the incoming owner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "LK: not pending owner");
        emit ConfigUpdated("owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ──────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────

    /// @dev How much of `token` can actually be pulled right now: the smaller
    ///      of the owner's balance and the allowance granted to this contract.
    function _pullable(address token) private view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(owner);
        uint256 allowed = IERC20(token).allowance(owner, address(this));
        return allowed < balance ? allowed : balance;
    }

    function pullableAmount(address token) external view returns (uint256) {
        return _pullable(token);
    }

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        return beneficiaries;
    }

    function getTrackedTokens() external view returns (address[] memory) {
        return trackedTokens;
    }

    function getTimeoutStatus()
        public
        view
        returns (bool timeoutExceeded, bool graceElapsed)
    {
        uint64 elapsed = uint64(block.timestamp) - liveness.lastHeartbeat;
        timeoutExceeded = elapsed >= liveness.timeoutDuration;
        graceElapsed = elapsed >= liveness.timeoutDuration + liveness.gracePeriod;
    }

    function getLivenessStatus()
        external
        view
        returns (uint64 lastHeartbeat, uint64 timeSinceHeartbeat, bool active, bool expired)
    {
        lastHeartbeat = liveness.lastHeartbeat;
        timeSinceHeartbeat = uint64(block.timestamp) - liveness.lastHeartbeat;
        active = liveness.livenessActive;
        (, expired) = getTimeoutStatus();
    }

    function beneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }

    receive() external payable {}
}
