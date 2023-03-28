import { ethers as hardhatEthers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"

import { deployPoolFactory, TestContracts } from "./deployTestContracts"
import { deployBounty } from "./deployBounty"
import { deployBrokerPool } from "./deployBrokerPool"

import type { Bounty, BrokerPool, TestToken } from "../../../typechain"

const { parseEther, id } = utils

export interface BountyTestSetup {
    token: TestToken
    bounty: Bounty
    staked: BrokerPool[]
    nonStaked: BrokerPool[]
}

export interface BountyTestSetupOptions {
    bountySettings?: any
    stakeAmountWei?: BigNumber
    bountyIsRunning?: boolean
}

/**
 * Sets up a Bounty and given number of brokers, each with BrokerPool that stakes 1000 tokens into the Bounty
 */
export async function setupBounty(contracts: TestContracts, stakedBrokerCount = 3, nonStakedBrokerCount = 0, saltSeed: string, {
    bountySettings = {},
    stakeAmountWei = parseEther("1000"),
    bountyIsRunning = true,
}: BountyTestSetupOptions = {}): Promise<BountyTestSetup> {
    const { token } = contracts

    // Hardhat provides 20 pre-funded signers
    const [admin, ...hardhatSigners] = await hardhatEthers.getSigners() as unknown as Wallet[]
    const signers = hardhatSigners.slice(0, stakedBrokerCount + nonStakedBrokerCount)

    // clean deployer wallet starts from nothing => needs ether to deploy BrokerPool etc.
    const deployer = new Wallet(id(saltSeed), admin.provider) // id turns string into bytes32
    await (await admin.sendTransaction({ to: deployer.address, value: parseEther("1") })).wait()
    // console.log("deployer: %s", addr(deployer))

    // we just want to re-deploy the BrokerPoolFactory (not all the policies or BountyFactory)
    // to generate deterministic BrokerPool addresses => deterministic reviewer selection
    const newContracts = {
        ...contracts,
        ...await deployPoolFactory(contracts, deployer)
    }
    // console.log("poolFactory: %s", addr(newContracts.poolFactory))
    // console.log("poolTemplate: %s", addr(newContracts.poolTemplate))

    // no risk of nonce collisions in Promise.all since each broker has their own separate nonce
    // see BrokerPoolFactory:_deployBrokerPool for how saltSeed is used in CREATE2
    const pools = await Promise.all(signers.map((signer) => deployBrokerPool(newContracts, signer, {}, saltSeed)))
    const staked = pools.slice(0, stakedBrokerCount)
    const nonStaked = pools.slice(stakedBrokerCount, stakedBrokerCount + nonStakedBrokerCount)
    // console.log("signers: %s", signers.map(addr).join(", "))
    // console.log("pools: %s", pools.map(addr).join(", "))

    // add broker also as the (only) node, so that flag/vote functions Just Work
    await Promise.all(pools.map(async (pool) => (await pool.setNodeAddresses([await pool.signer.getAddress()])).wait()))

    // ERC677 1-step (self-)delegation
    await Promise.all(signers.map((async (signer, i) =>
        (await token.connect(signer).transferAndCall(pools[i].address, stakeAmountWei, "0x")).wait()
    )))

    const bounty = await deployBounty(contracts, {
        allocationWeiPerSecond: BigNumber.from(0),
        penaltyPeriodSeconds: 0,
        brokerPoolOnly: true,
        ...bountySettings
    })
    if (bountyIsRunning) {
        await token.approve(bounty.address, parseEther("10000"))
        await bounty.sponsor(parseEther("10000"))
    }

    await Promise.all(staked.map((p) => p.stake(bounty.address, stakeAmountWei)))

    return {
        token,
        bounty,
        staked,
        nonStaked
    }
}
