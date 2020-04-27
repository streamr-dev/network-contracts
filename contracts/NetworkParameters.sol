pragma solidity ^0.6.0;

import "./Ownable.sol";

contract NetworkParameters is Ownable {
    uint public minProtocolVersion;
    address public tokenAddress;

    constructor(address owner, uint minProtocolVersion_, address tokenAddress_) public Ownable(owner){
        minProtocolVersion = minProtocolVersion_;
        tokenAddress = tokenAddress_;
    }

    function setMinProtocolVersion(uint version) public onlyOwner{
        minProtocolVersion = version;
    }

    function setTokenAddress(address tokenAddress_) public onlyOwner {
        tokenAddress = tokenAddress_;
    }
}