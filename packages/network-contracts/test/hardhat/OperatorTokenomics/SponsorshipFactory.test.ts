import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "./deploySponsorshipContract"
import { deployOperatorContract } from "./deployOperatorContract"
import { StreamRegistryV4 } from "../../../typechain"

const {
    getSigners,
    utils: { defaultAbiCoder, parseEther }
} = hardhatEthers

import type { Wallet } from "ethers"

let sponsorshipCounter = 0

async function createStream(deployerAddress: string, streamRegistry: StreamRegistryV4): Promise<string> {
    const streamPath = "/sponsorships/" + sponsorshipCounter++
    const streamId = deployerAddress.toLowerCase() + streamPath
    await (await streamRegistry.createStream(streamPath, streamId)).wait()
    return streamId
}

describe("SponsorshipFactory", () => {
    let admin: Wallet
    let notAdmin: Wallet
    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, notAdmin] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    it("can deploy a Sponsorship; then Operator can join, increase stake (happy path)", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorship(contracts)
        const pool = await deployOperatorContract(contracts, admin)
        await (await token.mint(pool.address, parseEther("400"))).wait()
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.emit(sponsorship, "OperatorJoined").withArgs(pool.address)
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.not.emit(sponsorship, "OperatorJoined")
    })

    it("can create a Sponsorship with transferAndCall (atomic fund and deploy sponsorship)", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts

        // uint minOperatorCount,
        // string memory streamId,
        // string memory metadata,
        // address[] memory policies,
        // uint[] memory policyParams
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [1, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        const sponsorshipDeployTx = await token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data)
        const sponsorshipDeployReceipt = await sponsorshipDeployTx.wait()
        const newSponsorshipAddress = sponsorshipDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        const newSponsorshipLog = sponsorshipDeployReceipt.logs.find((e) => e.address == sponsorshipFactory.address)
        if (!newSponsorshipLog) { throw new Error("NewSponsorship event not found") }  // typescript can't infer not-undefined from expect
        const newSponsorshipEvent = sponsorshipFactory.interface.parseLog(newSponsorshipLog)
        expect(newSponsorshipAddress).to.be.not.undefined
        expect(newSponsorshipEvent.name).to.equal("NewSponsorship")
        expect(newSponsorshipEvent.args.creator).to.equal(admin.address)
        expect(newSponsorshipEvent.args.sponsorshipContract).to.equal(newSponsorshipAddress)
        expect(newSponsorshipEvent.args.metadata).to.equal("{}")
        expect(newSponsorshipEvent.args.streamId).to.equal(streamId)
    })

    it("will NOT create a Sponsorship with zero minOperatorCount", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [0, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "MinOperatorCountZero")
    })

    it("will NOT create a Sponsorship with untrusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, maxOperatorsJoinPolicy, deployer, streamRegistry } = contracts
        /**
         * Policies array is interpreted as follows:
         *   0: allocation policy (address(0) for none)
         *   1: leave policy (address(0) for none)
         *   2: kick policy (address(0) for none)
         *   3+: join policies (leave out if none)
         */
        const untrustedAddress = "0x1234567890123456789012345678901234567890"
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        // allocationpolicy
        const streamId1 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId1, "{}",
            [untrustedAddress, leavePolicy.address, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // leavepolicy
        const streamId2 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId2, "{}",
            [allocationPolicy.address, untrustedAddress, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // kickpolicy
        const streamId3 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId3, "{}",
            [allocationPolicy.address, leavePolicy.address, untrustedAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // joinpolicy
        const streamId4 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId4, "{}",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
    })

    it("will NOT create a Sponsorship with mismatching number of policies and params", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(sponsorshipFactory.deploySponsorship(1, streamId, "{}",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    it("will NOT create a Sponsorship if the stream does not exist", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, voteKickPolicy } = contracts
        await expect(sponsorshipFactory.deploySponsorship(1, "0xnonexistingstreamid", "{}",
            [allocationPolicy.address, leavePolicy.address, voteKickPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_streamNotFound")
    })

    it("will NOT create a Sponsorship without an allocation policy", async function(): Promise<void> {
        const { sponsorshipFactory, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId, "{}",
            [],
            [])).to.be.revertedWith("error_allocationPolicyRequired")
    })

    it("will not create a Sponsorship with a zero allocation policy", async function(): Promise<void> {
        const { sponsorshipFactory, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId, "{}",
            [hardhatEthers.constants.AddressZero],
            ["0"])).to.be.revertedWith("error_allocationPolicyRequired")
    })

    it("is possible to have multilpe join policies", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, voteKickPolicy, maxOperatorsJoinPolicy,
            operatorContractOnlyJoinPolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await sponsorshipFactory.deploySponsorship(1, streamId, "{}",
            [allocationPolicy.address, leavePolicy.address, voteKickPolicy.address,
                maxOperatorsJoinPolicy.address, operatorContractOnlyJoinPolicy.address, hardhatEthers.constants.AddressZero],
            ["0", "0", "0", "0", "0", "0"])
    })

    // must be last test, will remove all policies in the sponsorshipFactory
    it("positivetest remove trusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, allocationPolicy, leavePolicy } = contracts
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.true
        await (await sponsorshipFactory.removeTrustedPolicy(maxOperatorsJoinPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(operatorContractOnlyJoinPolicy.address)).wait()
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.false
    })

    describe("SponsorshipFactory access control", () => {
        it("non admin role can't add trusted policies", async function(): Promise<void> {
            const { sponsorshipFactory, maxOperatorsJoinPolicy, allocationPolicy } = contracts
            await expect(sponsorshipFactory.connect(notAdmin).addTrustedPolicy(maxOperatorsJoinPolicy.address))
                .to.be.revertedWith("AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is " + 
                "missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
            await expect(sponsorshipFactory.connect(notAdmin).addTrustedPolicies([maxOperatorsJoinPolicy.address, allocationPolicy.address]))
                .to.be.revertedWith("AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is " + 
                "missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
        })

        it("non admin role can't remove trusted policies", async function(): Promise<void> {
            const { sponsorshipFactory, maxOperatorsJoinPolicy } = contracts
            await expect(sponsorshipFactory.connect(notAdmin).removeTrustedPolicy(maxOperatorsJoinPolicy.address))
                .to.be.revertedWith("AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is " +
                "missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
        })

        it("initializer can't be called twice", async function(): Promise<void> {
            const { sponsorshipFactory } = contracts
            await expect(sponsorshipFactory.initialize(
                hardhatEthers.constants.AddressZero,
                hardhatEthers.constants.AddressZero,
                hardhatEthers.constants.AddressZero,
            )).to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
})