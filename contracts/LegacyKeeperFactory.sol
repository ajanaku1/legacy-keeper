// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LegacyKeeper} from "./LegacyKeeper.sol";

/// @title LegacyKeeperFactory
/// @notice Verifies a wallet's complete setup intent and registers exactly one
///         LegacyKeeper plan for that owner.
contract LegacyKeeperFactory {
    struct PlanConfig {
        uint64 heartbeatInterval;
        uint64 timeoutDuration;
        uint64 gracePeriod;
        address[] beneficiaryWallets;
        uint16[] beneficiaryShares;
        address recoveryKey;
        address safeVault;
        address[] trackedTokens;
        bool allowSharedRecovery;
    }

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant CREATE_PLAN_TYPEHASH = keccak256(
        "CreatePlan(address owner,bytes32 configHash,uint256 nonce,uint256 deadline)"
    );

    mapping(address => address) public planOf;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    event PlanCreated(
        address indexed owner,
        address indexed plan,
        uint256 indexed nonce
    );

    function createPlan(
        address owner,
        PlanConfig calldata config,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (address planAddress) {
        require(owner != address(0), "LKF: invalid owner");
        require(planOf[owner] == address(0), "LKF: plan exists");
        _consumeCreationSignature(owner, config, nonce, deadline, signature);

        LegacyKeeper plan = new LegacyKeeper(owner);
        _initializePlan(plan, config);
        planAddress = address(plan);
        planOf[owner] = planAddress;
        emit PlanCreated(owner, planAddress, nonce);
    }

    function _consumeCreationSignature(
        address owner,
        PlanConfig calldata config,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) private {
        require(block.timestamp <= deadline, "LKF: signature expired");
        require(!nonceUsed[owner][nonce], "LKF: nonce used");

        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_PLAN_TYPEHASH,
                owner,
                hashPlanConfig(config),
                nonce,
                deadline
            )
        );
        require(_recover(_digest(structHash), signature) == owner, "LKF: invalid signature");
        nonceUsed[owner][nonce] = true;
    }

    function _initializePlan(
        LegacyKeeper plan,
        PlanConfig calldata config
    ) private {
        plan.initializePlan(
            config.heartbeatInterval,
            config.timeoutDuration,
            config.gracePeriod,
            config.beneficiaryWallets,
            config.beneficiaryShares,
            config.recoveryKey,
            config.safeVault,
            config.trackedTokens,
            config.allowSharedRecovery
        );
    }

    function hashPlanConfig(PlanConfig calldata config)
        public
        pure
        returns (bytes32)
    {
        bytes32 beneficiariesHash = keccak256(
            abi.encode(config.beneficiaryWallets, config.beneficiaryShares)
        );
        bytes32 tokensHash = keccak256(abi.encode(config.trackedTokens));
        return keccak256(
            abi.encode(
                config.heartbeatInterval,
                config.timeoutDuration,
                config.gracePeriod,
                beneficiariesHash,
                config.recoveryKey,
                config.safeVault,
                tokensHash,
                config.allowSharedRecovery
            )
        );
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("LegacyKeeperFactory")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), structHash)
        );
    }

    function _recover(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address)
    {
        require(signature.length == 65, "LKF: bad sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "LKF: malleable signature"
        );
        require(v == 27 || v == 28, "LKF: bad sig v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "LKF: invalid signer");
        return signer;
    }
}
