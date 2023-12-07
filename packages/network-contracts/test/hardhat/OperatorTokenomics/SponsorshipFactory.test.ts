import { ethers as hardhatEthers, upgrades } from "hardhat"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "../../../src/deploySponsorship"
import { deployOperator } from "../../../src/deployOperator"
import { SponsorshipFactory, StreamRegistryV4 } from "../../../typechain"

import type { Wallet } from "ethers"

const {
    getSigners,
    getContractFactory,
    utils: { defaultAbiCoder, parseEther },
    constants: { AddressZero },
} = hardhatEthers

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

    let adminRole: string

    before(async (): Promise<void> => {
        [admin, notAdmin] = await getSigners() as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token, sponsorshipFactory } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        adminRole = (await sponsorshipFactory.ADMIN_ROLE()).toLowerCase()
    })

    it("UUPS - admin can upgrade", async () => {
        const { sponsorshipFactory } = contracts
        await (await sponsorshipFactory.grantRole(adminRole, admin.address)).wait()

        const newContractFactory = await getContractFactory("SponsorshipFactory") // this is the upgraded version (e.g. SponsorshipFactoryV2)
        const newSponsorshipFactoryTx = await upgrades.upgradeProxy(sponsorshipFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] })
        const newSponsorshipFactory = await newSponsorshipFactoryTx.deployed() as SponsorshipFactory

        expect(sponsorshipFactory.address).to.equal(newSponsorshipFactory.address)
    })

    it("UUPS - notAdmin can NOT upgrade", async () => {
        const { sponsorshipFactory } = contracts
        const newContractFactory = await getContractFactory("SponsorshipFactory", notAdmin) // this is the upgraded version (e.g. StreamrConfigV2)

        await expect(upgrades.upgradeProxy(sponsorshipFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] }))
            .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`)
    })

    it("UUPS - storage is preserved after the upgrade", async () => {
        const { sponsorshipFactory } = contracts
        const sponsorship = await deploySponsorship(contracts)
        const deploymentTimestampBeforeUpgrade = await contracts.sponsorshipFactory.deploymentTimestamp(sponsorship.address)

        const newContractFactory = await getContractFactory("SponsorshipFactory") // this is the upgraded version (e.g. SponsorshipFactoryV2)
        const newSponsorshipFactoryTx = await upgrades.upgradeProxy(sponsorshipFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] })
        const newSponsorshipFactory = await newSponsorshipFactoryTx.deployed() as SponsorshipFactory

        expect(await newSponsorshipFactory.deploymentTimestamp(sponsorship.address)).to.equal(deploymentTimestampBeforeUpgrade)
    })

    it("UUPS - reverts if trying to call initialize()", async () => {
        const { streamrConfig, token, sponsorshipTemplate, sponsorshipFactory } = contracts
        await expect(sponsorshipFactory.initialize(
            sponsorshipTemplate.address,
            token.address,
            streamrConfig.address
        )).to.be.revertedWith("Initializable: contract is already initialized")
    })

    it("lets only admin update template address", async function(): Promise<void> {
        const { sponsorshipFactory, sponsorshipTemplate } = contracts
        const dummyAddress = hardhatEthers.Wallet.createRandom().address as string

        await expect(sponsorshipFactory.connect(notAdmin).updateTemplate(dummyAddress))
            .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`)
        await expect(sponsorshipFactory.updateTemplate(dummyAddress))
            .to.emit(sponsorshipFactory, "TemplateAddress").withArgs(dummyAddress)

        // restore the original template address
        await expect(sponsorshipFactory.updateTemplate(sponsorshipTemplate.address))
            .to.emit(sponsorshipFactory, "TemplateAddress").withArgs(sponsorshipTemplate.address)
    })

    it("can deploy a Sponsorship; then Operator can join, increase stake (happy path)", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorship(contracts)
        const operator = await deployOperator(contracts, admin)
        await (await token.approve(operator.address, parseEther("10000"))).wait()
        await (await operator.delegate(parseEther("10000"))).wait()
        await expect(operator.stake(sponsorship.address, parseEther("5000")))
            .to.emit(sponsorship, "OperatorJoined").withArgs(operator.address)
        await expect(operator.stake(sponsorship.address, parseEther("5000")))
            .to.not.emit(sponsorship, "OperatorJoined")
    })

    it("can create a Sponsorship with transferAndCall (atomic fund and deploy sponsorship)", async function(): Promise<void> {
        const { stakeWeightedAllocationPolicy, defaultLeavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts

        // uint minOperatorCount,
        // string memory streamId,
        // string memory metadata,
        // address[] memory policies,
        // uint[] memory policyParams
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(
            ["uint", "string", "string", "address[]", "uint[]"],
            [1, streamId, "{}", [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, AddressZero], ["2000000000000000000", "0", "0"]]
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

    it("transferAndCall reverts for wrong token", async function(): Promise<void> {
        const { stakeWeightedAllocationPolicy, defaultLeavePolicy, sponsorshipFactory, deployer, streamRegistry } = contracts
        const wrongToken = await (await getContractFactory("TestToken", { deployer })).deploy("TestToken", "TEST")
        await (await wrongToken.mint(deployer.address, parseEther("1000"))).wait()

        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [1, streamId, "{}", [
                stakeWeightedAllocationPolicy.address,
                defaultLeavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(wrongToken.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWithCustomError(contracts.sponsorshipFactory, "AccessDeniedDATATokenOnly")
    })

    it("will NOT create a Sponsorship with zero minOperatorCount", async function(): Promise<void> {
        const { stakeWeightedAllocationPolicy, defaultLeavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(
            ["uint", "string", "string", "address[]", "uint[]"],
            [0, streamId, "{}", [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, AddressZero], ["2000000000000000000", "0", "0"]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "MinOperatorCountZero")
    })

    it("will NOT create a Sponsorship with untrusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy, maxOperatorsJoinPolicy, deployer, streamRegistry } = contracts
        /**
         * Policies array is interpreted as follows:
         *   0: allocation policy (address(0) for none)
         *   1: leave policy (address(0) for none)
         *   2: kick policy (address(0) for none)
         *   3+: join policies (leave out if none)
         */
        const untrustedAddress = "0x1234567890123456789012345678901234567890"
        const kickPolicyAddress = AddressZero
        // allocationpolicy
        const streamId1 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId1, "{}",
            [untrustedAddress, defaultLeavePolicy.address, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "PolicyNotTrusted")
        const streamId2 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId2, "{}",
            [stakeWeightedAllocationPolicy.address, untrustedAddress, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "PolicyNotTrusted")
        // kickpolicy
        const streamId3 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId3, "{}",
            [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, untrustedAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "PolicyNotTrusted")
        // joinpolicy
        const streamId4 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId4, "{}",
            [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "PolicyNotTrusted")
    })

    it("will NOT create a Sponsorship with mismatching number of policies and params", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const kickPolicyAddress = AddressZero
        await expect(sponsorshipFactory.deploySponsorship(
            1, streamId, "{}",
            [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"]
        )).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "BadArguments")
    })

    it("will NOT create a Sponsorship if the stream does not exist", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy } = contracts
        await expect(sponsorshipFactory.deploySponsorship(
            1, "0xnonexistingstreamid", "{}", [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, AddressZero], ["0", "0", "0"]
        )).to.be.revertedWithCustomError(contracts.sponsorshipFactory, "StreamNotFound")
    })

    it("will NOT create a Sponsorship using transferAndCall if the stream does not exist", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy, token } = contracts

        const data = defaultAbiCoder.encode(
            ["uint", "string", "string", "address[]", "uint[]"],
            [1, "0xnonexistingstreamid", "{}", [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, AddressZero], ["0", "0", "0"]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWithCustomError(contracts.sponsorshipFactory, "StreamNotFound")
    })

    it("will NOT create a Sponsorship without an allocation policy", async function(): Promise<void> {
        const { sponsorshipFactory, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId, "{}", [], []))
            .to.be.revertedWithCustomError(contracts.sponsorshipFactory, "AllocationPolicyRequired")
    })

    it("will not create a Sponsorship with a zero allocation policy", async function(): Promise<void> {
        const { sponsorshipFactory, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(1, streamId, "{}", [AddressZero], ["0"]))
            .to.be.revertedWithCustomError(contracts.sponsorshipFactory, "AllocationPolicyRequired")
    })

    it("is possible to have multiple join policies", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy, voteKickPolicy, maxOperatorsJoinPolicy,
            operatorContractOnlyJoinPolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(
            1, streamId, "{}",
            [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address, voteKickPolicy.address,
                maxOperatorsJoinPolicy.address, operatorContractOnlyJoinPolicy.address, AddressZero],
            ["0", "0", "0", "0", "0", "0"]
        )).to.emit(sponsorshipFactory, "NewSponsorship")
    })

    it("is ok to leave out policies with shorter arrays", async function(): Promise<void> {
        const { sponsorshipFactory, stakeWeightedAllocationPolicy, defaultLeavePolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(
            1, streamId, "{}", [stakeWeightedAllocationPolicy.address, defaultLeavePolicy.address], ["0", "0"]
        )).to.emit(sponsorshipFactory, "NewSponsorship")
        await expect(sponsorshipFactory.deploySponsorship(
            1, streamId, "{}", [stakeWeightedAllocationPolicy.address], ["0"]
        )).to.emit(sponsorshipFactory, "NewSponsorship")
    })

    it("positivetest remove trusted policies", async function(): Promise<void> {
        const {
            sponsorshipFactory,
            maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, stakeWeightedAllocationPolicy, defaultLeavePolicy
        } = contracts
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(stakeWeightedAllocationPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(defaultLeavePolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.true
        await (await sponsorshipFactory.removeTrustedPolicy(maxOperatorsJoinPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(stakeWeightedAllocationPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(defaultLeavePolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(operatorContractOnlyJoinPolicy.address)).wait()
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(stakeWeightedAllocationPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(defaultLeavePolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.false
    })

    describe("SponsorshipFactory access control", () => {
        it("non-admin can't add trusted policies", async function(): Promise<void> {
            const { sponsorshipFactory, maxOperatorsJoinPolicy, stakeWeightedAllocationPolicy } = contracts
            await expect(sponsorshipFactory.connect(notAdmin).addTrustedPolicy(maxOperatorsJoinPolicy.address))
                .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`)
            await expect(sponsorshipFactory.connect(notAdmin).addTrustedPolicies([
                maxOperatorsJoinPolicy.address, stakeWeightedAllocationPolicy.address
            ])).to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`)
        })

        it("non-admin can't remove trusted policies", async function(): Promise<void> {
            const { sponsorshipFactory, maxOperatorsJoinPolicy } = contracts
            await expect(sponsorshipFactory.connect(notAdmin).removeTrustedPolicy(maxOperatorsJoinPolicy.address))
                .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`)
        })

        it("initializer can't be called twice", async function(): Promise<void> {
            const { sponsorshipFactory } = contracts
            await expect(sponsorshipFactory.initialize(AddressZero, AddressZero, AddressZero))
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
})
