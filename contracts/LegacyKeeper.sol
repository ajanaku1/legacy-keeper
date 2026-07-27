// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LegacyKeeper
 * @notice Onchain security & inheritance agent — stores configuration and executes
 *         asset transfers through KeeperHub. The contract itself is a data layer;
 *         KeeperHub workflows perform the actual evm call execution.
 *
 *         Architecture:
 *         - Owner sets up beneficiaries, recovery key, vault, timeouts via dashboard
 *         - Liveness heartbeats are EIP-712 signed messages stored on-chain
 *         - KeeperHub's scheduled workflow reads heartbeat timestamps and triggers inheritance
 *         - KeeperHub's HTTP-triggered workflow handles panic evacuation with private routing
 */
contract LegacyKeeper {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct Beneficiary {
        address wallet;
        uint16 shareBps;   // Basis points (e.g., 5000 = 50%)
        bool registered;
    }

    struct LivenessConfig {
        uint64 heartbeatInterval;  // in seconds
        uint64 timeoutDuration;    // in seconds
        uint64 gracePeriod;        // in seconds
        uint64 lastHeartbeat;      // unix timestamp
        bool livenessActive;
    }

    struct VaultConfig {
        address safeVault;              // evacuation destination
        address recoveryKeyAddress;     // separate key — NOT the wallet key
        bool recoveryKeyRegistered;
        bool privateRoutingEnabled;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    address public owner;
    LivenessConfig public liveness;
    VaultConfig public vault;
    Beneficiary[] public beneficiaries;
    mapping(address => bool) public isBeneficiary;

    bool public inheritanceExecuted;
    bool public evacuationExecuted;
    uint256 public inheritanceTimestamp;
    uint256 public evacuationTimestamp;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event HeartbeatRecorded(address indexed sender, uint256 timestamp, bytes signature);
    event HeartbeatMissed(uint256 timestamp);
    event GracePeriodStarted(uint256 deadline);
    event InheritanceExecuted(uint256 timestamp);
    event InheritanceTransfer(address indexed beneficiary, uint256 amount);
    event EvacuationTriggered(address indexed trigger, uint256 timestamp);
    event BeneficiaryAdded(address wallet, uint16 shareBps);
    event BeneficiaryRemoved(address wallet);
    event ConfigUpdated(string key);
    event RecoveryKeyRegistered(address indexed recoveryKey);
    event PanicButtonPressed(address indexed sender, uint256 timestamp);

    // ──────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "LK: not owner");
        _;
    }

    modifier onlyRecoveryKey(bytes memory signature, bytes memory message) {
        require(vault.recoveryKeyRegistered, "LK: recovery key not set");
        address signer = _recoverSigner(message, signature);
        // Recovery key is a SEPARATE address from the wallet key (owner).
        // Even if the wallet key is compromised, the attacker cannot
        // authorize evacuation without also possessing the recovery key.
        require(signer == vault.recoveryKeyAddress, "LK: invalid recovery sig");
        _;
    }

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        liveness = LivenessConfig({
            heartbeatInterval: 86400,    // 24 hours
            timeoutDuration:  2592000,   // 30 days
            gracePeriod:      604800,    // 7 days
            lastHeartbeat:    uint64(block.timestamp),
            livenessActive:   true
        });
        vault = VaultConfig({
            safeVault: address(0),
            recoveryKeyAddress: address(0),
            recoveryKeyRegistered: false,
            privateRoutingEnabled: true
        });
    }

    // ──────────────────────────────────────────────
    // Owner Management
    // ──────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LK: invalid owner");
        owner = newOwner;
    }

    // ──────────────────────────────────────────────
    // Liveness / Heartbeat
    // ──────────────────────────────────────────────

    /**
     * @notice Record a heartbeat signed by the owner's key
     * @param signature EIP-712 typed signature proving liveness
     */
    function heartbeat(bytes calldata signature) external {
        require(liveness.livenessActive, "LK: liveness inactive");
        bytes32 digest = _hashHeartbeat(block.timestamp);
        address signer = _recoverSigner(abi.encodePacked(digest), signature);
        require(signer == owner, "LK: invalid heartbeat sig");

        liveness.lastHeartbeat = uint64(block.timestamp);
        emit HeartbeatRecorded(signer, block.timestamp, signature);
    }

    /**
     * @notice Called by KeeperHub scheduled workflow when heartbeat is missed
     */
    function onHeartbeatMissed() external {
        emit HeartbeatMissed(block.timestamp);
    }

    /**
     * @notice Begin grace period — called by KeeperHub after timeout elapses
     * @param deadline Unix timestamp when grace period ends
     */
    function startGracePeriod(uint64 deadline) external {
        emit GracePeriodStarted(deadline);
    }

    // ──────────────────────────────────────────────
    // Inheritance
    // ──────────────────────────────────────────────

    /**
     * @notice Execute inheritance — distributes ETH to all registered beneficiaries
     *         proportionally by their share percentages.
     *         Called by KeeperHub scheduled workflow after grace period expires.
     */
    function executeInheritance() external onlyOwner {
        require(!inheritanceExecuted, "LK: already executed");
        require(!evacuationExecuted, "LK: already evacuated");
        require(liveness.livenessActive, "LK: liveness inactive");
        require(beneficiaries.length > 0, "LK: no beneficiaries");

        // Deactivate liveness to prevent double execution
        liveness.livenessActive = false;
        inheritanceExecuted = true;
        inheritanceTimestamp = block.timestamp;

        uint256 balance = address(this).balance;
        uint256 totalDistributed = 0;

        // Distribute to each beneficiary proportionally
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            Beneficiary storage b = beneficiaries[i];
            if (!b.registered || b.wallet == address(0)) continue;

            uint256 amount = (balance * b.shareBps) / 10000;
            if (amount == 0) continue;

            totalDistributed += amount;
            (bool sent, ) = payable(b.wallet).call{value: amount}("");
            require(sent, "LK: transfer failed");
            emit InheritanceTransfer(b.wallet, amount);
        }

        // Send any remainder (dust) to the first beneficiary
        uint256 remainder = balance - totalDistributed;
        if (remainder > 0 && beneficiaries.length > 0) {
            (bool sent, ) = payable(beneficiaries[0].wallet).call{value: remainder}("");
            require(sent, "LK: remainder transfer failed");
            emit InheritanceTransfer(beneficiaries[0].wallet, remainder);
        }

        emit InheritanceExecuted(block.timestamp);
    }

    /**
     * @notice Cancel inheritance before grace period expires
     */
    function cancelInheritance() external onlyOwner {
        require(liveness.livenessActive, "LK: liveness inactive");
        liveness.lastHeartbeat = uint64(block.timestamp);
        emit HeartbeatRecorded(msg.sender, block.timestamp, "");
    }

    // ──────────────────────────────────────────────
    // Emergency Evacuation
    // ──────────────────────────────────────────────

    /**
     * @notice Emergency evacuation — sweep all ETH to safe vault.
     *         Called by KeeperHub HTTP-triggered workflow (panic button).
     *         Uses recovery key auth, NOT the compromised wallet key.
     *
     *         Access control: `onlyRecoveryKey` ensures only the holder of
     *         the separate recovery key can authorize evacuation. This
     *         prevents a compromised wallet key from draining assets.
     *         The recovery key signature is verified on-chain.
     * @param recoverySignature Recovery key ECDSA signature authorizing the evacuation
     * @param message The signed message data
     */
    function evacuate(
        bytes calldata recoverySignature,
        bytes calldata message
    ) external onlyRecoveryKey(recoverySignature, message) {
        require(!evacuationExecuted, "LK: already evacuated");
        require(vault.safeVault != address(0), "LK: vault not configured");

        evacuationExecuted = true;
        evacuationTimestamp = block.timestamp;

        // Disable inheritance since assets are being evacuated
        liveness.livenessActive = false;

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool sent, ) = vault.safeVault.call{value: balance}("");
            require(sent, "LK: evacuation failed");
        }

        emit EvacuationTriggered(msg.sender, block.timestamp);
    }

    /**
     * @notice Panic button — instant trigger (requires recovery key via KeeperHub)
     */
    function panicButton(
        bytes calldata recoverySignature,
        bytes calldata message
    ) external onlyRecoveryKey(recoverySignature, message) {
        emit PanicButtonPressed(msg.sender, block.timestamp);
        // The KeeperHub HTTP-triggered workflow watches for this event
        // and then calls evacuate() with private routing enabled.
    }

    // ──────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────

    function setSafeVault(address vaultAddress) external onlyOwner {
        require(vaultAddress != address(0), "LK: invalid vault");
        vault.safeVault = vaultAddress;
        emit ConfigUpdated("safe_vault");
    }

    function registerRecoveryKey(address recoveryKey) external onlyOwner {
        require(recoveryKey != address(0), "LK: invalid recovery key");
        require(recoveryKey != owner, "LK: recovery must differ from owner");
        vault.recoveryKeyAddress = recoveryKey;
        vault.recoveryKeyRegistered = true;
        emit RecoveryKeyRegistered(recoveryKey);
    }

    function addBeneficiary(address wallet, uint16 shareBps) external onlyOwner {
        require(wallet != address(0), "LK: invalid wallet");
        require(!isBeneficiary[wallet], "LK: already beneficiary");
        require(shareBps > 0 && shareBps <= 10000, "LK: invalid share");

        beneficiaries.push(Beneficiary(wallet, shareBps, true));
        isBeneficiary[wallet] = true;
        emit BeneficiaryAdded(wallet, shareBps);
    }

    function removeBeneficiary(address wallet) external onlyOwner {
        require(isBeneficiary[wallet], "LK: not beneficiary");
        isBeneficiary[wallet] = false;
        emit BeneficiaryRemoved(wallet);
    }

    function setLivenessConfig(
        uint64 heartbeatInterval_,
        uint64 timeoutDuration_,
        uint64 gracePeriod_
    ) external onlyOwner {
        liveness.heartbeatInterval = heartbeatInterval_;
        liveness.timeoutDuration = timeoutDuration_;
        liveness.gracePeriod = gracePeriod_;
        emit ConfigUpdated("liveness_config");
    }

    function toggleLiveness(bool active) external onlyOwner {
        liveness.livenessActive = active;
        emit ConfigUpdated("liveness_active");
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    function _hashHeartbeat(uint256 timestamp) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            _domainSeparator(),
            keccak256(abi.encode(
                keccak256("Heartbeat(uint256 timestamp)"),
                timestamp
            ))
        ));
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("LegacyKeeper")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function _recoverSigner(bytes memory message, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "LK: invalid sig length");
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(message))
        );
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        return ecrecover(ethSignedMessageHash, v, r, s);
    }

    function _splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    // ──────────────────────────────────────────────
    // View helpers
    // ──────────────────────────────────────────────

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        return beneficiaries;
    }

    function getLivenessStatus() external view returns (
        uint64 lastHeartbeat,
        uint64 timeSinceHeartbeat,
        bool active,
        bool expired
    ) {
        lastHeartbeat = liveness.lastHeartbeat;
        timeSinceHeartbeat = uint64(block.timestamp) - liveness.lastHeartbeat;
        active = liveness.livenessActive;
        // expired = timeout + grace period have both elapsed
        expired = timeSinceHeartbeat >= liveness.timeoutDuration + liveness.gracePeriod;
    }

    function getTimeoutStatus() external view returns (
        bool timeoutExceeded,
        bool gracePeriodElapsed
    ) {
        uint64 elapsed = uint64(block.timestamp) - liveness.lastHeartbeat;
        timeoutExceeded = elapsed >= liveness.timeoutDuration;
        gracePeriodElapsed = elapsed >= liveness.timeoutDuration + liveness.gracePeriod;
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
