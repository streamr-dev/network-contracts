import { ethers, upgrades } from "hardhat"
import { Operator, OperatorFactory, IUndelegationPolicy, IDelegationPolicy, IExchangeRatePolicy, StreamrConfig } from "../typechain"

import type { Wallet } from "ethers"

import Debug from "debug"
const log = Debug("streamr:deploy-tatum")

interface OperatorFactoryPlusDependents {
    operatorFactory: OperatorFactory
    operatorTemplate: Operator
    defaultDelegationPolicy: IDelegationPolicy
    defaultUndelegationPolicy: IUndelegationPolicy
    defaultExchangeRatePolicy: IExchangeRatePolicy
}

export async function deployOperatorFactory(
    signer: Wallet,
    tokenAddress: string,
    streamrConfigAddress: string
): Promise<OperatorFactoryPlusDependents> {
    const operatorTemplate = await (await ethers.getContractFactory("Operator")).deploy() as Operator
    await operatorTemplate.deployed()
    log("Deployed Operator contract template", operatorTemplate.address)

    const defaultDelegationPolicy = await (await ethers.getContractFactory("DefaultDelegationPolicy", { signer })).deploy() as IDelegationPolicy
    await defaultDelegationPolicy.deployed()
    log("Deployed default Operator contract delegation policy", defaultDelegationPolicy.address)

    const defaultExchangeRatePolicy = await (await ethers.getContractFactory("DefaultExchangeRatePolicy", { signer })).deploy() as IExchangeRatePolicy
    await defaultExchangeRatePolicy.deployed()
    log("Deployed defaultExchangeRatePolicy", defaultExchangeRatePolicy.address)

    const defaultUndelegationPolicy = await (await ethers.getContractFactory("DefaultUndelegationPolicy", { signer })).deploy() as IUndelegationPolicy
    await defaultUndelegationPolicy.deployed()
    log("Deployed default Operator contract undelegation policy", defaultUndelegationPolicy.address)

    const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory", { signer })
    const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
        operatorTemplate.address,
        tokenAddress,
        streamrConfigAddress,
    ], {kind: "uups", unsafeAllow: ["delegatecall"]}) as unknown as OperatorFactory
    await operatorFactory.deployed()
    log("Deployed Operator contract factory", operatorFactory.address)

    await (await operatorFactory.addTrustedPolicies([
        defaultDelegationPolicy.address,
        defaultExchangeRatePolicy.address,
        defaultUndelegationPolicy.address,
    ])).wait()
    log("Added trusted policies")

    const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer })
    const streamrConfig = await streamrConfigFactory.attach(streamrConfigAddress) as StreamrConfig
    await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
    log("Done setting Operator contract factory in StreamrConfig")

    return {
        operatorFactory,
        operatorTemplate,
        defaultDelegationPolicy,
        defaultUndelegationPolicy,
        defaultExchangeRatePolicy,
    }
}
