//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./StreamRegistry/StreamRegistryV3.sol"; 
// Used only for testing purposes
contract TestERC20 is ERC20 {
    constructor () ERC20("TestToken", "TST") {}

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}

contract ERC20JoinPolicy is Ownable{
    IERC20 public token;

    string public streamId;
    uint256 public minRequiredBalance;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 public streamRegistry;

    event Accepted (address indexed user);

    constructor(
        address tokenAddress_,
        string memory streamId_,
        address streamRegistryAddress_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_
    ) Ownable() {
        token = IERC20(tokenAddress_);
        streamId = streamId_;
        permissions = permissions_;
        minRequiredBalance = minRequiredBalance_;
        streamRegistry = StreamRegistryV3(streamRegistryAddress_);
    }

    function canJoin(address user_) public view returns (bool) {
        return (token.balanceOf(user_) >= minRequiredBalance);
    }

    function requestJoin() public {
        require(canJoin(_msgSender()), "Not enough tokens");
        accept(_msgSender());
    }

    function accept(address user_) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, user_, permissions[i]);
        }
        emit Accepted(user_);
    }

}
