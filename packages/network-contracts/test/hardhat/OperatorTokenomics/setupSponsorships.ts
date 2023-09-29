import { ethers as hardhatEthers } from "hardhat"

import { deployOperatorFactory, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "./deploySponsorshipContract"
import { deployOperatorContract } from "./deployOperatorContract"

import type { BigNumber, Wallet } from "ethers"
import type { Sponsorship, Operator, OperatorFactory, TestToken } from "../../../typechain"

const { parseEther, id } = hardhatEthers.utils

export interface SponsorshipTestSetup {
    token: TestToken
    sponsorships: Sponsorship[]
    operators: Operator[]
    operatorsPerSponsorship: Operator[][]
    operatorFactory: OperatorFactory
}

export interface SponsorshipTestSetupOptions {
    sponsorshipSettings?: any
    operatorsCutFraction?: BigNumber
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
 * Sets up a Sponsorships with given number of operators staked to each; each with Operator that stakes 1000 tokens into that Sponsorship
 */
export async function setupSponsorships(contracts: TestContracts, operatorCounts = [0, 3], saltSeed: string, {
    sponsorshipSettings = {},
    operatorsCutFraction = parseEther("1"),
    stakeAmountWei = parseEther("1000"),
    sponsor = true,
}: SponsorshipTestSetupOptions = {}): Promise<SponsorshipTestSetup> {
    const { token } = contracts

    // Hardhat provides 20 pre-funded signers
    const [admin, ...hardhatSigners] = await hardhatEthers.getSigners() as unknown as Wallet[]
    const totalOperatorCount = operatorCounts.reduce((a, b) => a + b, 0)
    const sponsorshipCount = operatorCounts.length
    const signers = hardhatSigners.slice(0, totalOperatorCount)

    // clean deployer wallet starts from nothing => needs ether to deploy Operator etc.
    const deployer = new Wallet(id(saltSeed), admin.provider) // id turns string into bytes32
    await (await admin.sendTransaction({ to: deployer.address, value: parseEther("1") })).wait()
    // console.log("deployer: %s", addr(deployer))

    // we just want to re-deploy the OperatorFactory (not all the policies or SponsorshipFactory)
    // to generate deterministic Operator addresses => deterministic reviewer selection
    const newContracts = {
        ...contracts,
        ...await deployOperatorFactory(contracts, deployer)
    }

    // no risk of nonce collisions in Promise.all since each operator has their own separate nonce
    // see OperatorFactory:_deployOperator for how saltSeed is used in CREATE2
    const operators = await Promise.all(signers.map((signer) =>
        deployOperatorContract(newContracts, signer, operatorsCutFraction, { metadata: "{}" }, saltSeed)))
    const operatorsPerSponsorship = splitBy(operators, operatorCounts)

    // add operator also as the (only) node, so that flag/vote functions Just Work
    await Promise.all(operators.map(async (op) => (await op.setNodeAddresses([await op.signer.getAddress()])).wait()))

    // ERC677 1-step (self-)delegation
    await Promise.all(signers.map((async (signer, i) =>
        (await token.connect(signer).transferAndCall(operators[i].address, stakeAmountWei, "0x")).wait()
    )))

    const sponsorships: Sponsorship[] = []
    for (let i = 0; i < sponsorshipCount; i++) {
        const staked = operatorsPerSponsorship[i]
        const sponsorship = await deploySponsorship(contracts, {
            allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 0,
            ...sponsorshipSettings
        })
        if (sponsor) {
            await token.approve(sponsorship.address, parseEther("10000"))
            await sponsorship.sponsor(parseEther("10000"))
        }

        await Promise.all(staked.map((p) => p.stake(sponsorship.address, stakeAmountWei)))
        sponsorships.push(sponsorship)
    }

    return {
        token,
        sponsorships,
        operators,
        operatorsPerSponsorship,
        operatorFactory: newContracts.operatorFactory
    }
}
