// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice A USDT-shaped ERC-20: transfer/transferFrom/approve return NOTHING.
 *         This is not a hypothetical — USDT on mainnet behaves exactly this
 *         way, and a plain `IERC20(token).transferFrom(...)` reverts on the
 *         missing bool. Used to prove _safeTransferFrom handles it.
 */
contract MockUSDT {
    string public name = "Mock Tether";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 initialSupply) {
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
    }

    // Deliberately no `returns (bool)`.
    function approve(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
    }

    function transferFrom(address from, address to, uint256 value) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "USDT: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}
