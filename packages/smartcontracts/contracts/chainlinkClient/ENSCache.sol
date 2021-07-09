// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

// import "@chainlink/contracts/src/v0.6/ChainlinkClient.sol";
// import "@chainlink/contracts/src/v0.6/Chainlink.sol";
import "../Chainlink0.6/ChainlinkClient.sol";
import "../Chainlink0.6/Chainlink.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ENSCache is ChainlinkClient, Ownable {
  using Chainlink for Chainlink.Request;

  uint256 constant private ORACLE_PAYMENT = 1 * LINK;

  mapping(string => address) public owners;
  mapping(bytes32 => string) public sentRequests;
  address public oracle;
  string public jobId;

  function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address sender) {
    return super._msgSender();
  }

  function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
    return super._msgData();
  }

  constructor(address oracleaddress, string memory chainlinkJobId, address trustedForwarder) 
  ChainlinkClient(trustedForwarder) Ownable() {
    oracle = oracleaddress;
    jobId = chainlinkJobId;
  }

  function setOracleAdress(address oracleAddress) public onlyOwner {
    oracle = oracleAddress;
  }

  function setChainlinkTokenAddress(address _link) public onlyOwner {
    super.setChainlinkToken(_link);
  }

  function setChainlinkJobId(string calldata chainlinkJobId) public onlyOwner {
    jobId = chainlinkJobId;
  }

  function requestENSOwner(string calldata ensName) public {
    Chainlink.Request memory req = buildChainlinkRequest(stringToBytes32(jobId), address(this), this.fulfillENSOwner.selector);
    req.add("ensname", ensName);
    bytes32 requestid = sendChainlinkRequestTo(oracle, req, ORACLE_PAYMENT);
    sentRequests[requestid] = ensName;
  }

  function fulfillENSOwner(bytes32 requestId, bytes32 owneraddress) public recordChainlinkFulfillment(requestId) {
    owners[sentRequests[requestId]] = address(uint160(uint256(owneraddress)));
  }
  
  function getChainlinkToken() public view returns (address) {
    return chainlinkTokenAddress();
  }

  function withdrawLink() public onlyOwner {
    LinkTokenInterface link = LinkTokenInterface(chainlinkTokenAddress());
    require(link.transfer(_msgSender(), link.balanceOf(address(this))), "Unable to transfer");
  }

  function cancelRequest(bytes32 _requestId, uint256 _payment, bytes4 _callbackFunctionId,
    uint256 _expiration) public onlyOwner {
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