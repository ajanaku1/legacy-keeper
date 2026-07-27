// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice A token that blocks one address, the way USDC and USDT blocklists do.
 *         Real, not hypothetical: a sanctioned or frozen beneficiary must not
 *         be able to strand the rest of an estate.
 */
contract MockBlacklistToken {
    string public name = "Blacklist";
    string public symbol = "BLK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public blocked;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply, address blocked_) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        blocked = blocked_;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != blocked, "BLK: recipient blocked");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "BLK: allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/**
 * @notice Returns malformed return data — 4 bytes, neither empty nor a bool.
 *         `abi.decode(data, (bool))` reverts on this, taking the whole
 *         distribution down with it.
 */
contract MockMalformedToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) { balanceOf[msg.sender] = supply; }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "MAL: allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 4) // 4 bytes: too short to decode as bool
        }
    }
}
