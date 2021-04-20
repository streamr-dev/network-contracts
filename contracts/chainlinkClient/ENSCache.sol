pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/dev/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/dev/Chainlink.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ENSCache is ChainlinkClient, Ownable {
  using Chainlink for Chainlink.Request;

  uint256 constant private ORACLE_PAYMENT = 1 * LINK_DIVISIBILITY;

  // address public resolvedEnsAddress;
  mapping(string => address) public owners;
  mapping(bytes32 => string) public sentRequests;


  constructor() public Ownable() {
    setPublicChainlinkToken();
  }

  function requestENSOwner(address oracle, string calldata jobId, string calldata ensName) public onlyOwner {
    Chainlink.Request memory req = buildChainlinkRequest(stringToBytes32(jobId), address(this), this.fulfillENSOwner.selector);
    req.add("ensname", ensName);
    bytes32 requestid = sendChainlinkRequestTo(oracle, req, ORACLE_PAYMENT);
    sentRequests[requestid] = ensName;
  }

  function fulfillENSOwner(bytes32 requestId, bytes32 owneraddress) public recordChainlinkFulfillment(requestId) {
    //emit RequestEthereumLastMarket(_requestId, _market);
    owners[sentRequests[requestId]] = address(uint160(uint256(owneraddress)));
  }
  
  // function setResultAddress(bytes32 _market)
  //   public  {
  //   resolvedEnsAddress = address(uint160(uint256(_market)));
  // }
  

  function getChainlinkToken() public view returns (address) {
    return chainlinkTokenAddress();
  }

  function withdrawLink() public onlyOwner {
    LinkTokenInterface link = LinkTokenInterface(chainlinkTokenAddress());
    require(link.transfer(msg.sender, link.balanceOf(address(this))), "Unable to transfer");
  }

  function cancelRequest(
    bytes32 _requestId,
    uint256 _payment,
    bytes4 _callbackFunctionId,
    uint256 _expiration
  )
    public
    onlyOwner
  {
    cancelChainlinkRequest(_requestId, _payment, _callbackFunctionId, _expiration);
  }
  
  function stringToBytes32(string memory source) private pure returns (bytes32 result) {
    bytes memory tempEmptyStringTest = bytes(source);
    if (tempEmptyStringTest.length == 0) {
      return 0x0;
    }

    assembly { // solhint-disable-line no-inline-assembly
      result := mload(add(source, 32))
    }
  }
}