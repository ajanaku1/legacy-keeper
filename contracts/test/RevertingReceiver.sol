// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A beneficiary that refuses ETH. Used to prove one hostile or
///         broken recipient cannot brick distribution for everyone else.
contract RevertingReceiver {
    receive() external payable {
        revert("RR: refuses ether");
    }
}
