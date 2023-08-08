import { ContractFactory } from '@ethersproject/contracts'
import { parseEther } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'

import { DataUnionTemplate as templateJson, DataUnionFactory as factoryJson, DefaultFeeOracle as feeOracleJson } from '@dataunions/contracts'
import type { DataUnionTemplate, DataUnionFactory, IFeeOracle } from '@dataunions/contracts/typechain'

// import debug from 'debug'
// const log = debug('DataUnionClient:unit-tests:withdraw')
const { log } = console

async function deployDataUnionTemplate(deployer: Wallet): Promise<DataUnionTemplate> {
    log("deployDataUnionTemplate (deployer=%s)", deployer.address)
    const factory = new ContractFactory(templateJson.abi, templateJson.bytecode, deployer)
    const contract = await factory.deploy() as unknown as DataUnionTemplate
    return contract.deployed()
}

async function deployFeeOracle(deployer: Wallet, protocolBeneficiaryAddress: string): Promise<IFeeOracle> {
    log("deployFeeOracle (deployer=%s, protocolBeneficiaryAddress=%s)", deployer.address, protocolBeneficiaryAddress)
    const factory = new ContractFactory(feeOracleJson.abi, feeOracleJson.bytecode, deployer)
    const contract = await factory.deploy() as unknown as IFeeOracle
    await contract.deployed()
    const tx = await contract.initialize(
        parseEther("0.01"),
        protocolBeneficiaryAddress,
    )
    await tx.wait()
    return contract
}

async function deployDataUnionFactory(
    deployer: Wallet,
    templateAddress: string,
    tokenAddress: string,
    protocolFeeOracleAddress: string,
): Promise<DataUnionFactory> {
    log("deployDataUnionFactory (deployer=%s, templateAddress=%s, tokenAddress=%s, protocolFeeOracleAddress=%s)")
    const factory = new ContractFactory(factoryJson.abi, factoryJson.bytecode, deployer)
    const contract = await factory.deploy() as unknown as DataUnionFactory
    await contract.deployTransaction.wait()
    const tx = await contract.initialize(
        templateAddress,
        tokenAddress,
        protocolFeeOracleAddress,
    )
    await tx.wait()
    return contract
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default async function deployDataUnionContracts(tokenAddress: string, deployer: Wallet) {
    log("deployDataUnionContracts (tokenAddress=%s, deployer=%s)", tokenAddress, deployer.address)
    await deployer.provider.getNetwork().catch(() => {
        throw new Error('No network found. Please start e.g. `hardhat node`')
    })

    const dataUnionTemplate = await deployDataUnionTemplate(deployer)
    const feeOracle = await deployFeeOracle(deployer, deployer.address) // make deployer (the DAO) also protocol beneficiary
    const dataUnionFactory = await deployDataUnionFactory(
        deployer,
        dataUnionTemplate.address,
        tokenAddress,
        feeOracle.address
    )

    log("Deployed dataUnionFactory at %s", dataUnionFactory.address)
    return {
        dataUnionFactory,
        dataUnionTemplate
    }
}
