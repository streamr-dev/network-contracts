// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";

contract StreamRegistryNFT is ERC721, ERC721Enumerable, ERC721URIStorage, Pausable, Ownable, ERC721Burnable {
    uint public rollingId = 0;
    mapping (uint256 => Permission) public permissions;
    struct Permission {
        uint256 streamId;
        bool isAdmin;
        uint8 publishExpirationTime;
        uint8 subscriptionExpirationTime;
    }

    constructor() ERC721("StreamRegistry", "STR") {}

    function createStream(address streamowner, string memory desc) public {
        // require(bytes(streamIdToMetadata[id]).length == 0, "item id alreay exists!");
        rollingId = rollingId + 1;
        uint streamid = rollingId;
        _safeMint(streamowner, streamid);
        _setTokenURI(rollingId, desc);
        rollingId = rollingId + 1;
        _safeMint(streamowner, rollingId);

        permissions[rollingId] = 
        Permission({
            streamId: streamid,
            isAdmin: true,
            publishExpirationTime: 1,
            subscriptionExpirationTime: 1
        });
        // emit StreamCreated(rollingId, msg.sender, desc);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function safeMint(address to, uint256 tokenId) public onlyOwner {
        _safeMint(to, tokenId);
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId)
        internal
        whenNotPaused
        override(ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}