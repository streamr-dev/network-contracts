const {
    ContractFactory,
    Wallet,
    providers: { JsonRpcProvider },
    utils: { getAddress },
} = require("ethers")

const DataUnionMainnet = require("./ethereumContractJSONs/DataUnionMainnet.json")
const DataUnionSidechain = require("./ethereumContractJSONs/DataUnionSidechain.json")
const DataUnionFactorySidechain = require("./ethereumContractJSONs/DataUnionFactorySidechain.json")
const DataUnionFactoryMainnet = require("./ethereumContractJSONs/DataUnionFactoryMainnet.json")
const MainnetMigrationManager = require("./ethereumContractJSONs/MainnetMigrationManager.json")
const SidechainMigrationManager = require("./ethereumContractJSONs/SidechainMigrationManager.json")

const log = process.env.QUIET ? (() => { }) : console.log // eslint-disable-line no-console
// class LoggingProvider extends JsonRpcProvider {
//     perform(method, parameters) {
//         console.log(">>>", method, parameters);
//         return super.perform(method, parameters).then((result) => {
//             console.log("<<<", method, parameters, result);
//             return result;
//         });
//     }
// }
const provider_foreign = new JsonRpcProvider('http://10.200.10.1:8545')
const provider_home = new JsonRpcProvider('http://10.200.10.1:8546')

const wallet_home = new Wallet('0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', provider_home)
const wallet_foreign = new Wallet('0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', provider_foreign)
const home_erc_mediator = process.env.HOME_ERC677_MEDIATOR
const foreign_erc_mediator = process.env.FOREIGN_ERC677_MEDIATOR

// getAddress throws if bad address or env var not set
const foreign_erc20 = getAddress(process.env.ERC20_TOKEN_ADDRESS)
const home_erc677 = getAddress(process.env.HOME_ERC677)
const foreign_mediator = getAddress(process.env.FOREIGN_ERC677_MEDIATOR)
const home_mediator = getAddress(process.env.HOME_ERC677_MEDIATOR)
const zeroAddress = "0x0000000000000000000000000000000000000000"

log(`foreign_erc20 ${foreign_erc20} home_erc677 ${home_erc677}`)

async function deployDUFactories() {
    log(`Deploying template DU home contract from ${wallet_home.address}`)
    let deployer = new ContractFactory(DataUnionSidechain.abi, DataUnionSidechain.bytecode, wallet_home)
    let dtx = await deployer.deploy({ gasLimit: 6000000 })
    let duhome = await dtx.deployed()
    console.log(`duhome template: ${duhome.address}`)

    log(`Deploying template DU mainnet contract from ${wallet_foreign.address}`)
    deployer = new ContractFactory(DataUnionMainnet.abi, DataUnionMainnet.bytecode, wallet_foreign)
    dtx = await deployer.deploy({ gasLimit: 6000000 })
    let duforeign = await dtx.deployed()
    console.log(`duforeign template: ${duforeign.address}`)

    log(`Deploying MainnetMigrationManager contract from ${wallet_foreign.address}`)
    deployer = new ContractFactory(MainnetMigrationManager.abi, MainnetMigrationManager.bytecode, wallet_foreign)
    dtx = await deployer.deploy(foreign_erc20, foreign_erc_mediator, { gasLimit: 6000000 })
    let mainnetMigrationMgr = await dtx.deployed()
    console.log(`MainnetMigrationManager template: ${mainnetMigrationMgr.address}`)

    log(`Deploying SidechainMigrationManager contract from ${wallet_foreign.address}`)
    deployer = new ContractFactory(SidechainMigrationManager.abi, SidechainMigrationManager.bytecode, wallet_home)
    dtx = await deployer.deploy(home_erc677, zeroAddress, home_erc_mediator, { gasLimit: 6000000 })
    let sidechainMigrationMgr = await dtx.deployed()
    console.log(`SidechainMigrationManager template: ${sidechainMigrationMgr.address}`)

    // constructor( address _token_mediator, address _data_union_sidechain_template) public {
    log(`Deploying sidechain DU factory contract from ${wallet_home.address}`)
    deployer = new ContractFactory(DataUnionFactorySidechain.abi, DataUnionFactorySidechain.bytecode, wallet_home)
    dtx = await deployer.deploy(duhome.address, { gasLimit: 6000000 })
    let factSidechain = await dtx.deployed()
    console.log(`factorySidechain: ${factSidechain.address}`)

    /*  constructor(
            address _dataUnionMainnetTemplate,
            address _dataUnionSidechainTemplate,
            address _dataUnionSidechainFactory,
            address _defaultTokenMainnet,
            address _defaultTokenMediatorMainnet,
            address _defaultTokenSidechain,
            address _defaultTokenMediatorSidechain,
            uint256 _sidechainMaxGas)
    */
    log(`Deploying DU mainnet factory contract from ${wallet_foreign.address}`)
    deployer = new ContractFactory(DataUnionFactoryMainnet.abi, DataUnionFactoryMainnet.bytecode, wallet_foreign)
    dtx = await deployer.deploy(
        duforeign.address,
        duhome.address,
        factSidechain.address,
        foreign_erc20,
        foreign_mediator,
        home_erc677,
        home_mediator,
        2000000,
        { gasLimit: 6000000 }
    )
    let factMainnet = await dtx.deployed()
    console.log(`factMainnet: ${factMainnet.address}`)

}

async function start() {
    try {
        await deployDUFactories()
    }
    catch (err) {
        console.error(err)
    }
}
start()

