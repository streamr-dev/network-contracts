import { ethers as hardhatEthers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"

import { deployPoolFactory, TestContracts } from "./deployTestContracts"
import { deployBounty } from "./deployBounty"
import { deployBrokerPool } from "./deployBrokerPool"

import type { Bounty, BrokerPool, BrokerPoolFactory, TestToken } from "../../../typechain"

const { parseEther, id } = utils

export interface BountyTestSetup {
    token: TestToken
    bounties: Bounty[]
    pools: BrokerPool[]
    poolsPerBounty: BrokerPool[][]
    poolFactory: BrokerPoolFactory
}

export interface BountyTestSetupOptions {
    bountySettings?: any
    stakeAmountWei?: BigNumber
    sponsor?: boolean
}

function splitBy<T>(arr: T[], counts: number[]): T[][] {
    const result = []
    let i = 0
    for (const count of counts) {
        result.push(arr.slice(i, i + count))
        i += count
    }
    return result
}

/**
 * Sets up a Bounties with given number of brokers staked to each; each with BrokerPool that stakes 1000 tokens into that Bounty
 */
export async function setupBounties(contracts: TestContracts, brokerCounts = [0, 3], saltSeed: string, {
    bountySettings = {},
    stakeAmountWei = parseEther("1000"),
    sponsor = true,
}: BountyTestSetupOptions = {}): Promise<BountyTestSetup> {
    const { token } = contracts

    // Hardhat provides 20 pre-funded signers
    const [admin, ...hardhatSigners] = await hardhatEthers.getSigners() as unknown as Wallet[]
    const totalBrokerCount = brokerCounts.reduce((a, b) => a + b, 0)
    const bountyCount = brokerCounts.length
    const signers = hardhatSigners.slice(0, totalBrokerCount)

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
    const poolsPerBounty = splitBy(pools, brokerCounts)

    // add broker also as the (only) node, so that flag/vote functions Just Work
    await Promise.all(pools.map(async (pool) => (await pool.setNodeAddresses([await pool.signer.getAddress()])).wait()))

    // ERC677 1-step (self-)delegation
    await Promise.all(signers.map((async (signer, i) =>
        (await token.connect(signer).transferAndCall(pools[i].address, stakeAmountWei, "0x")).wait()
    )))

    const bounties: Bounty[] = []
    for (let i = 0; i < bountyCount; i++) {
        const stakedPools = poolsPerBounty[i]
        const bounty = await deployBounty(contracts, {
            allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 0,
            brokerPoolOnly: true,
            ...bountySettings
        })
        if (sponsor) {
            await token.approve(bounty.address, parseEther("10000"))
            await bounty.sponsor(parseEther("10000"))
        }

        await Promise.all(stakedPools.map((p) => p.stake(bounty.address, stakeAmountWei)))
        bounties.push(bounty)
    }

    return {
        token,
        bounties,
        pools,
        poolsPerBounty,
        poolFactory: newContracts.poolFactory
    }
}
