// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "./IERC677.sol";
import "./IERC677Receiver.sol";

contract DATAv2 is ERC20Permit, ERC20Burnable, AccessControl, IERC677 {
    string private _name = "Streamr";
    string private _symbol = "DATA";

    event UpdatedTokenInformation(string newName, string newSymbol);

    // ------------------------------------------------------------------------
    // adapted from @openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol
    bytes32 constant public MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor() ERC20("", "") ERC20Permit(_name) {
        // make contract deployer the role admin that can later grant the minter role
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function isMinter(
        address minter
    ) public view returns (bool) {
        return hasRole(MINTER_ROLE, minter);
    }

    /**
     * @dev Creates `amount` new tokens for `to`.
     *
     * See {ERC20-_mint}.
     *
     * Requirements:
     *
     * - the caller must have the `MINTER_ROLE`.
     */
    function mint(
        address to,
        uint256 amount
    ) public {
        require(isMinter(_msgSender()), "Transaction signer is not a minter");
        _mint(to, amount);
    }

    // ------------------------------------------------------------------------
    // adapted from LINK token, see https://etherscan.io/address/0x514910771af9ca656af840dff83e8264ecf986ca#code
    // implements https://github.com/ethereum/EIPs/issues/677
    /**
     * @dev transfer token to a contract address with additional data if the recipient is a contact.
     * @param _to The address to transfer to.
     * @param _value The amount to be transferred.
     * @param _data The extra data to be passed to the receiving contract.
     */
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) public override returns (bool success) {
        super.transfer(_to, _value);
        emit Transfer(_msgSender(), _to, _value, _data);

        uint256 recipientCodeSize;
        assembly { // solhint-disable-line no-inline-assembly
            recipientCodeSize := extcodesize(_to)
        }
        if (recipientCodeSize > 0) {
            IERC677Receiver receiver = IERC677Receiver(_to);
            receiver.onTokenTransfer(_msgSender(), _value, _data);
        }
        return true;
    }

    // ------------------------------------------------------------------------
    // allow admin to change the token name and symbol

    modifier onlyAdmin {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "Transaction signer is not an admin");
        _;
    }

    function setTokenInformation(string calldata newName, string calldata newSymbol) public onlyAdmin {
        _name = newName;
        _symbol = newSymbol;
        emit UpdatedTokenInformation(_name, _symbol);
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the name.
     */
    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
