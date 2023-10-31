import { ethers as hardhatEthers } from "hardhat"

import { deployOperatorFactory, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "./deploySponsorshipContract"
import { deployOperatorContract } from "./deployOperatorContract"

import { Wallet, BigNumber } from "ethers"
import type { Sponsorship, Operator, OperatorFactory, TestToken } from "../../../typechain"

const { parseEther, id } = hardhatEthers.utils

export interface SponsorshipTestSetup {
    token: TestToken
    sponsorships: Sponsorship[]
    operators: Operator[]
    operatorsPerSponsorship: Operator[][]
    operatorFactory: OperatorFactory
    newContracts: TestContracts
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

/** Get a given number of test wallets funded with native and test token. Re-use hardhat signers first. */
async function getTestWallets(contracts: TestContracts, count: number, minTokenBalance: BigNumber): Promise<Wallet[]> {
    // initialize with hardhat signers; they already have native token, so mint them test token too
    const [admin,, ...testWallets] = await hardhatEthers.getSigners() as Wallet[] // leave out admin, protocol

    // check everyone has enough tokens
    for (const wallet of testWallets.slice(0, count)) {
        if ((await contracts.token.balanceOf(wallet.address)).lt(minTokenBalance)) {
            await (await contracts.token.mint(wallet.address, minTokenBalance)).wait()
        }
    }

    // generate and fund more if needed
    while (testWallets.length < count) {
        const wallet = hardhatEthers.Wallet.createRandom().connect(admin.provider) as Wallet
        await (await admin.sendTransaction({ to: wallet.address, value: parseEther("10") })).wait()
        await (await contracts.token.mint(wallet.address, parseEther("1000000"))).wait()
        testWallets.push(wallet)
    }

    return testWallets.slice(0, count)
}

/**
 * Sets up a Sponsorships with given number of operators staked to each; each with Operator that stakes 1000 tokens into that Sponsorship
 */
export async function setupSponsorships(contracts: TestContracts, operatorCounts = [0, 3], saltSeed: string, {
    sponsorshipSettings = {},
    operatorsCutFraction = parseEther("1"),
    stakeAmountWei = parseEther("10000"),
    sponsor = true,
}: SponsorshipTestSetupOptions = {}): Promise<SponsorshipTestSetup> {
    const { token } = contracts
    const [admin] = await hardhatEthers.getSigners() as unknown as Wallet[]
    const totalOperatorCount = operatorCounts.reduce((a, b) => a + b, 0)
    const sponsorshipCount = operatorCounts.length
    const signers = await getTestWallets(contracts, totalOperatorCount, stakeAmountWei)

    // clean deployer wallet starts from nothing => needs ether to deploy Operator etc.
    const deployer = new hardhatEthers.Wallet(id(saltSeed), admin.provider) // id turns string into bytes32
    await (await admin.sendTransaction({ to: deployer.address, value: parseEther("1") })).wait()

    const loadedWallet = new Wallet("0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", admin.provider)
    await (await loadedWallet.sendTransaction({ to: deployer.address, value: parseEther("100000") })).wait()
    
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
        deployOperatorContract(newContracts, signer, operatorsCutFraction, {}, saltSeed)))
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
            allocationWeiPerSecond: parseEther("0"),
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
        newContracts
    }
}
