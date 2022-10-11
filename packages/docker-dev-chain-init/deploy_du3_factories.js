const { ethers, upgrades } = require("hardhat")

const {
    Wallet,
    providers: { JsonRpcProvider },
    utils: { parseEther }
} = ethers

const { log } = console

const provider = new JsonRpcProvider("http://10.200.10.1:8545")
const tokenAddress = `0xbAA81A0179015bE47Ad439566374F2Bae098686F` // DATAv2
const dao = new Wallet("0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14", provider)
const admin = new Wallet("0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", provider)

async function main() {
    const dataUnionTemplateFactory = await ethers.getContractFactory("DataUnionTemplate", admin)
    const dataUnionTemplate = await dataUnionTemplateFactory.deploy()
    await dataUnionTemplate.deployed()
    log("DU3 DataUnionTemplate deployed at %s", dataUnionTemplate.address)

    const feeOracleFactory = await ethers.getContractFactory("DefaultFeeOracle", dao)
    const feeOracle = await upgrades.deployProxy(feeOracleFactory, [
        parseEther("0.01"),
        dao.address
    ], { kind: "uups" })
    await feeOracle.deployed()
    log("DU3 DefaultFeeOracle deployed at %s", feeOracle.address)

    const factoryFactory = await ethers.getContractFactory("DataUnionFactory", admin)
    const factory = await upgrades.deployProxy(factoryFactory, [
        dataUnionTemplate.address,
        tokenAddress,
        feeOracle.address,
    ], { kind: "uups" })
    log("DU3 DataUnionFactory deployed at %s", factory.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
