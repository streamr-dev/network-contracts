import { upgrades, ethers as hardhatEthers } from "hardhat"
import { utils, Wallet } from "ethers"

import type { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, IKickPolicy, ILeavePolicy } from "../typechain"
import { TestToken } from "../typechain/TestToken"

const { parseEther } = utils
const { getContractFactory } = hardhatEthers

export type TestContracts = {
    token: TestToken;
    minStakeJoinPolicy: IJoinPolicy;
    maxBrokersJoinPolicy: IJoinPolicy;
    allocationPolicy: IAllocationPolicy;
    leavePolicy: ILeavePolicy;
    kickPolicy: IKickPolicy;
    bountyFactory: BountyFactory;
    bountyTemplate: Bounty;
}

/**
 * Deploy all contracts needed by tests. This should be called in "before/beforeAll".
 * NB: trustedForwarder shouldn't be same as deployer, otherwise _msgSender() will return garbage
 *     see @openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol
 * @param deployer wallet used for all deployments
 * @param trustedForwarder given as argument to BountyFactory; set to zero if not given
 * @returns mapping: name string -> ethers.Contract object
 */
export async function deployTestContracts(deployer: Wallet, trustedForwarder?: Wallet): Promise<TestContracts> {
    const token = await (await getContractFactory("TestToken", deployer)).deploy("TestToken", "TEST") as TestToken
    await token.deployed()

    const minStakeJoinPolicy = await (await getContractFactory("MinimumStakeJoinPolicy", deployer)).deploy() as IJoinPolicy
    await minStakeJoinPolicy.deployed()

    const maxBrokersJoinPolicy = await (await getContractFactory("MaxAmountBrokersJoinPolicy", deployer)).deploy() as IJoinPolicy
    await maxBrokersJoinPolicy.deployed()

    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", deployer)).deploy() as IAllocationPolicy
    await allocationPolicy.deployed()

    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", deployer)).deploy() as ILeavePolicy
    await leavePolicy.deployed()

    const kickPolicy = await (await getContractFactory("AdminKickPolicy", deployer)).deploy() as IKickPolicy

    const bountyTemplate = await (await getContractFactory("Bounty")).deploy() as Bounty
    await bountyTemplate.deployed()

    // function initialize(address templateAddress, address trustedForwarderAddress, address _tokenAddress) public initializer {
    const bountyFactoryFactory = await getContractFactory("BountyFactory", deployer)
    const bountyFactory = await upgrades.deployProxy(bountyFactoryFactory, [
        bountyTemplate.address,
        trustedForwarder?.address ?? "0x0000000000000000000000000000000000000000",
        token.address
    ]) as BountyFactory
    await bountyFactory.deployed()
    await (await bountyFactory.connect(deployer).addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        kickPolicy.address,
        minStakeJoinPolicy.address,
        maxBrokersJoinPolicy.address,
    ])).wait()

    return {
        token, minStakeJoinPolicy, maxBrokersJoinPolicy, allocationPolicy, leavePolicy, kickPolicy, bountyTemplate, bountyFactory
    }
}

export async function deployBountyContract(contracts: TestContracts, {
    minHorizonSeconds = 0,
    minBrokerCount = 1,
    penaltyPeriodSeconds = 0,
    minStakeWei = 1,
    maxBrokerCount = 100,
    allocationWeiPerSecond = parseEther("1"),
} = {}): Promise<Bounty> {
    const {
        token, minStakeJoinPolicy, maxBrokersJoinPolicy, allocationPolicy, leavePolicy, kickPolicy, bountyTemplate, bountyFactory
    } = contracts
    /**
     * Policies array is interpreted as follows:
     *   0: allocation policy (address(0) for none)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     * @param policies smart contract addresses found in the trustedPolicies
     function deployBountyAgreement(
        uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        string memory bountyName,
        address[] memory policies,
        uint[] memory initParams
    )
    */
    const bountyDeployTx = await bountyFactory.deployBountyAgreement(
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        `Bounty-${Date.now()}`,
        [
            allocationPolicy.address,
            leavePolicy.address,
            kickPolicy.address,
            minStakeJoinPolicy.address,
            maxBrokersJoinPolicy.address,
        ],
        [
            allocationWeiPerSecond.toString(),
            penaltyPeriodSeconds.toString(),
            "0",
            minStakeWei.toString(),
            maxBrokerCount.toString()
        ]
    )
    const bountyDeployReceipt = await bountyDeployTx.wait()
    const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
    const newBountyAddress = newBountyEvent?.args?.bountyContract
    const bounty = bountyTemplate.attach(newBountyAddress)
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}
