/**
 * Deployed on 2021-01-11 to 0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@ensdomains/ens-contracts/contracts/utils/NameEncoder.sol";

interface IInterchainQueryRouter {
    function query(
        uint32 _destinationDomain,
        address target,
        bytes calldata queryData,
        bytes calldata callback
    ) external returns (bytes32);
}

interface IInterchainGasPaymaster {
    function payForGas(
        bytes32 _messageId,
        uint32 _destinationDomain,
        uint256 _gasAmount,
        address _refundAddress
    ) external payable;

    function quoteGasPayment(uint32 _destinationDomain, uint256 _gasAmount)
        external
        view
        returns (uint256);
}

interface IStreamRegistry {
    // solhint-disable-next-line func-name-mixedcase
    function ENScreateStreamCallback(address requestorAddress, string memory ensName, string calldata streamIdPath, string calldata metadataJsonString) external;
}

interface IENS {
    function owner(bytes32 nameHash) external view returns (address);
}

contract ENSCacheV1 is OwnableUpgradeable, UUPSUpgradeable {
    mapping(string => address) public owners;

    mapping(address => string[]) public tempENSnames;
    mapping(address => string[]) public tempIdPaths;
    mapping(address => string[]) public tempMetadatas;

    IStreamRegistry private streamRegistry;
    IInterchainQueryRouter public interchainQueryRouter;
    IInterchainGasPaymaster public interchainGasPaymaster;
    uint32 public constant DESTINATION_CHAIN_ID = 1;
    address public constant ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;

    modifier onlyCallback() {
        require(msg.sender == address(interchainQueryRouter));
        _;
    }

    function initialize(IStreamRegistry _streamRegistry, IInterchainQueryRouter _interchainQueryRouter,
        IInterchainGasPaymaster _interchainGasPaymaster) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        streamRegistry = _streamRegistry;
        interchainQueryRouter = _interchainQueryRouter;
        interchainGasPaymaster = _interchainGasPaymaster;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function updateHyperlaneContracts(IInterchainQueryRouter _interchainQueryRouter,
        IInterchainGasPaymaster _interchainGasPaymaster) public onlyOwner {
        interchainQueryRouter = _interchainQueryRouter;
        interchainGasPaymaster = _interchainGasPaymaster;
    }

    function invalidateENSCache(string calldata ensName) public {
        require(msg.sender == owners[ensName], "error_notOldENSOwner");
        owners[ensName] = address(0);
    }

    /** Update cache and create a stream */
    function requestENSOwnerAndCreateStream(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString, address requestorAddress) public {
        (, bytes32 nameHash) = NameEncoder.dnsEncodeName(ensName);
        bytes32 messageId = interchainQueryRouter.query(
            DESTINATION_CHAIN_ID,
            ENS_REGISTRY,
            abi.encodeCall(IENS.owner, (nameHash)),
            abi.encodePacked(this.fulfillENSOwner.selector)
        );

        uint256 gasAmount = _estimateGasForQueryPurchaseInfo();
        _payInterchainGas(messageId, gasAmount, address(this));
        
        tempENSnames[requestorAddress].push(ensName);
        tempIdPaths[requestorAddress].push(streamIdPath);
        tempMetadatas[requestorAddress].push(metadataJsonString);
    }

    function fulfillENSOwner(address ENSowner) public onlyCallback {
        for(uint i = 0; i < tempENSnames[ENSowner].length; i++) {
            owners[tempENSnames[ENSowner][i]] = ENSowner;
        }
        for(uint i = 0; i < tempENSnames[ENSowner].length; i++) {
            try streamRegistry.ENScreateStreamCallback(ENSowner, tempENSnames[ENSowner][i], tempIdPaths[ENSowner][i], tempMetadatas[ENSowner][i]) {
            } catch {
                // do nothing
            }
        }
        delete tempENSnames[ENSowner];
        delete tempIdPaths[ENSowner];
        delete tempMetadatas[ENSowner];
    }

    /**
     * Helper function to estimate the gas amount needed for the recipient's function
     */
    function _estimateGasForQueryPurchaseInfo() private pure returns (uint256 gasAmount) {
        uint256 queryGasAmount = 0; // TODO: estimate
        uint256 overheadGasAmount = 80000;
        return queryGasAmount + overheadGasAmount;
    }
    /**
     * @param messageId - the id of the message that is being paid for
     * @param gasAmount - the gas used by the query being made
     * @param refundAddress - the address where the exceeded gas amount will be sent to (anything over what quoteGasPayment returns)
     * @dev If a refund is unsuccessful, the payForGas call will revert.
     * @dev Refunding overpayment involves the IGP contract calling the _refundAddress, which can present a risk of reentrancy
     */
    function _payInterchainGas(bytes32 messageId, uint256 gasAmount, address refundAddress) private {
        uint256 quotedPayment = interchainGasPaymaster.quoteGasPayment(DESTINATION_CHAIN_ID, gasAmount);
        interchainGasPaymaster.payForGas{value: quotedPayment}(messageId, DESTINATION_CHAIN_ID, gasAmount, refundAddress);
    }
}