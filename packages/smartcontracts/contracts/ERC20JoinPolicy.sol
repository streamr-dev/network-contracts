//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./StreamRegistry/StreamRegistryV3.sol"; 
import "./DelegatedAccessRegistry.sol";
// Used only for testing purposes
contract TestERC20 is ERC20 {
    constructor () ERC20("TestToken", "TST") {}

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}

contract ERC20JoinPolicy is Ownable{
    IERC20 public token;
    DelegatedAccessRegistry public delegatedAccessRegistry;
    string public streamId;
    uint256 public minRequiredBalance;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 public streamRegistry;

    event Accepted (address indexed user);

    constructor(
        address delegatedAccessRegistryAddress,
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_
    ) Ownable() {
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
        token = IERC20(tokenAddress);
        streamRegistry = StreamRegistryV3(streamRegistryAddress);

        streamId = streamId_;
        permissions = permissions_;
        minRequiredBalance = minRequiredBalance_;
    }

    function canJoin(address user_) public view returns (bool) {
        return (token.balanceOf(user_) >= minRequiredBalance);
    }

    function requestJoin() public {
        require(canJoin(_msgSender()), "Not enough tokens");
        accept(_msgSender());
    }

    function requestDelegatedJoin(address user_) public {
        require(delegatedAccessRegistry.isUserAuthorized(_msgSender(), user_), "Not authorized");
        require(canJoin(_msgSender()), "Not enough tokens");
	accept(_msgSender());
        accept(user_);
    }

    function accept(address user_) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, user_, permissions[i]);
        }
        emit Accepted(user_);
    }

}
