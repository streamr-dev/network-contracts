import { upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils, constants, BigNumber, Wallet } from "ethers"

import type { DATAv2, MinimalForwarder, ProjectRegistryV1, ProjectStakingV1 } from "../../typechain"

const { id, hexlify, parseEther, toUtf8Bytes, zeroPad } = utils
const { getContractFactory } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console

describe('ProjectStakingV1', (): void => {
    let admin: Wallet
    let staker1: Wallet
    let staker2: Wallet
    let beneficiary: Wallet
    let trusted: Wallet
    let forwarder: Wallet
    
    const domainIds: number[] = []
    const paymentDetails: any[] = [] // PaymentDetailsByChain[]
    const paymentDetailsFreeProject: any[] = [] // PaymentDetailsByChain[]

    let projectStaking: ProjectStakingV1
    let projectRegistry: ProjectRegistryV1
    let minimalForwarder: MinimalForwarder
    let token: DATAv2
    let token2: DATAv2

    const stakingAmount1 = parseEther("100")
    const stakingAmount2 = parseEther("200")
    const stakingAmount3 = parseEther("500")
    const unstakingAmount = parseEther("25")
    const projectId1 = hexlify(zeroPad(toUtf8Bytes('project1'), 32))
    const projectId2 = hexlify(zeroPad(toUtf8Bytes('project2'), 32))
    const nonExistingProject = hexlify(zeroPad(toUtf8Bytes('nonExistingProject'), 32))

    before(async (): Promise<void> => {
        [admin, staker1, staker2, beneficiary, trusted, forwarder] = await hardhatEthers.getSigners() as unknown as Wallet[]
        await deployERC20()
        await deployMinimalForwarder()
        await deployProjectRegistry()
        await deployProjectStaking()

        domainIds.push(0x706f6c79) // polygon domain id assigned by hyperlane
        paymentDetails.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(2) // pricePerSecond
        ])
        paymentDetailsFreeProject.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(0) // pricePerSecond
        ])
    })

    async function deployERC20(): Promise<void> {
        const tokenFactory = await getContractFactory("DATAv2", admin)
        token = await tokenFactory.deploy() as DATAv2
        await token.grantRole(id("MINTER_ROLE"), admin.address) // admin can mint tokens for others

        const token2Factory = await getContractFactory("DATAv2", admin)
        token2 = await token2Factory.deploy() as DATAv2
        await token2.grantRole(id("MINTER_ROLE"), admin.address) // admin can mint tokens for others
    }

    async function deployMinimalForwarder(): Promise<void> {
        const factory = await getContractFactory('MinimalForwarder', forwarder)
        minimalForwarder = await factory.deploy() as MinimalForwarder
    }

    async function deployProjectRegistry(): Promise<void> {
        const contractFactory = await getContractFactory("ProjectRegistryV1", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [constants.AddressZero], { kind: 'uups' })
        projectRegistry = await contractFactoryTx.deployed() as ProjectRegistryV1

        const trustedRole = await projectRegistry.getTrustedRole()
        await projectRegistry.grantRole(trustedRole, trusted.address)

        const trustedForwarderRole = await projectRegistry.TRUSTED_FORWARDER_ROLE()
        await projectRegistry.grantRole(trustedForwarderRole, minimalForwarder.address)
    }

    async function deployProjectStaking(): Promise<void> {
        const contractFactory = await getContractFactory("ProjectStakingV1")
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [projectRegistry.address, token.address], { kind: 'uups' })
        projectStaking = await contractFactoryTx.deployed() as ProjectStakingV1
    }

    async function createProject({
        projectId = hexlify(zeroPad(toUtf8Bytes('project-' + Date.now()), 32)),
        chains = domainIds,
        payment = paymentDetails,
        minimumSubscriptionSeconds = 1,
        isPublicPurchable = true,
        metadata = "metadata-" + Date.now(),
        creator = admin
    } = {}): Promise<string> {
        await projectRegistry.connect(creator)
            .createProject(projectId, chains, payment, [], minimumSubscriptionSeconds, isPublicPurchable, metadata)
        log("   - created project: ", projectId)
        return projectId
    }
    
    describe('Staking & Unstaking', (): void => {
        it(`stake() - positivetest - staker1 is staking ${stakingAmount1} tokens for project ${projectId1}`, async () => {
            await createProject({ projectId: projectId1})
            await token.connect(admin).mint(staker1.address, stakingAmount1)
            await token.connect(staker1).approve(projectStaking.address, stakingAmount1)

            const balanceBeforeStaking = await token.balanceOf(staker1.address)
            await expect(projectStaking.connect(staker1).stake(projectId1, stakingAmount1))
                .to.emit(projectStaking, "Stake")
                .withArgs(projectId1, staker1.address, stakingAmount1)
            const balanceAfterStaking = await token.balanceOf(staker1.address)
            const userStake = await projectStaking.getUserStake(staker1.address)

            expect(balanceAfterStaking).to.equal(balanceBeforeStaking.sub(stakingAmount1))
            expect(userStake).to.equal(stakingAmount1)
        })

        it(`stake() - positivetest - staker2 is staking ${stakingAmount2} tokens for project ${projectId2}`, async () => {
            await createProject({ projectId: projectId2})
            await token.connect(admin).mint(staker2.address, stakingAmount2)
            await token.connect(staker2).approve(projectStaking.address, stakingAmount2)

            const balanceBeforeStaking = await token.balanceOf(staker2.address)
            await expect(projectStaking.connect(staker2).stake(projectId2, stakingAmount2))
                .to.emit(projectStaking, "Stake")
                .withArgs(projectId2, staker2.address, stakingAmount2)
            const balanceAfterStaking = await token.balanceOf(staker2.address)
            const userStake = await projectStaking.getUserStake(staker2.address)

            expect(balanceAfterStaking).to.equal(balanceBeforeStaking.sub(stakingAmount2))
            expect(userStake).to.equal(stakingAmount2)
        })

        it(`stake() - positivetest - staket1 & staker2 are staking ${stakingAmount3} tokens for projects ${projectId1} & ${projectId2}`, async () => {
            await token.connect(admin).mint(staker1.address, stakingAmount3)
            await token.connect(admin).mint(staker2.address, stakingAmount3)
            await token.connect(staker1).approve(projectStaking.address, stakingAmount3)
            await token.connect(staker2).approve(projectStaking.address, stakingAmount3)

            const staket1BalanceBefore = await token.balanceOf(staker1.address)
            const staket2BalanceBefore = await token.balanceOf(staker2.address)
            await projectStaking.connect(staker1).stake(projectId1, stakingAmount3) // staker1 stakes for project2
            await projectStaking.connect(staker2).stake(projectId2, stakingAmount3) // staker2 stakes for project1
            const staket1BalanceAfter = await token.balanceOf(staker1.address)
            const staket2BalanceAfter = await token.balanceOf(staker2.address)

            expect(staket1BalanceAfter).to.equal(staket1BalanceBefore.sub(stakingAmount3))
            expect(staket2BalanceAfter).to.equal(staket2BalanceBefore.sub(stakingAmount3))
        })

        it(`stake() - negativetest - insufficient stake`, async () => {
            await expect(projectStaking.connect(staker1).stake(projectId1, stakingAmount1))
                .to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })

        it(`stake() - negativetest - insufficient allowance`, async () => {
            await token.connect(admin).mint(staker1.address, stakingAmount1)
            await expect(projectStaking.connect(staker1).stake(projectId1, stakingAmount1))
                .to.be.revertedWith("ERC20: transfer amount exceeds allowance")
        })

        it(`stake() - negativetest - staking to a not existing project`, async () => {
            await token.connect(admin).mint(staker1.address, stakingAmount1)
            await expect(projectStaking.connect(staker1).stake(nonExistingProject, stakingAmount1))
                .to.be.revertedWith("error_projectNotFound")
        })

        // This test case is dependent on the first 3 test cases and will fail if they are not executed before
        it(`getProjectStake() - positivetest - calculates the stake for all users on a project`, async () => {
            const project1Stake = await projectStaking.getProjectStake(projectId1)
            const project2Stake = await projectStaking.getProjectStake(projectId2)
            expect(project1Stake).to.equal(stakingAmount1.add(stakingAmount3))
            expect(project2Stake).to.equal(stakingAmount2.add(stakingAmount3))
        })

        // This test case is dependent on the first 3 test cases and will fail if they are not executed before
        it(`getUserStake() - positivetest - calculates the stake for a user across all projects`, async () => {
            const user1Stake = await projectStaking.getUserStake(staker1.address)
            const user2Stake = await projectStaking.getUserStake(staker2.address)
            expect(user1Stake).to.equal(stakingAmount1.add(stakingAmount3))
            expect(user2Stake).to.equal(stakingAmount2.add(stakingAmount3))
        })

        // This test case is dependent on the first 3 test cases and will fail if they are not executed before
        it(`getTotalStake() - positivetest - calculates the stake for all user across all projects`, async () => {
            const totalStake = await projectStaking.getTotalStake()
            expect(totalStake).to.equal(stakingAmount1.add(stakingAmount2).add(stakingAmount3).add(stakingAmount3)) // 2x stakingAmount3
        })

        it(`unstake() - positivetest - staker1 unstakes ${unstakingAmount} tokens from project ${projectId1}`, async () => {
            const userStakeBefore = await projectStaking.getUserStake(staker1.address)
            const projectStakeBefore = await projectStaking.getProjectStake(projectId1)
            const totalStakeBefore = await projectStaking.getTotalStake()
            await expect(projectStaking.connect(staker1).unstake(projectId1, unstakingAmount))
                .to.emit(projectStaking, "Unstake")
                .withArgs(projectId1, staker1.address, unstakingAmount)
            const userStakeAfter = await projectStaking.getUserStake(staker1.address)
            const projectStakeAfter = await projectStaking.getProjectStake(projectId1)
            const totalStakeAfter = await projectStaking.getTotalStake()

            expect(userStakeAfter).to.equal(userStakeBefore.sub(unstakingAmount))
            expect(projectStakeAfter).to.equal(projectStakeBefore.sub(unstakingAmount))
            expect(totalStakeAfter).to.equal(totalStakeBefore.sub(unstakingAmount))
        })

        it(`unstake() - negative - can not unstake more the staked amount`, async () => {
            const userStake = await projectStaking.getUserStake(staker1.address)
            await expect(projectStaking.connect(staker1).unstake(projectId1, userStake.add(1)))
                .to.be.revertedWith("error_notEnoughTokensStaked")
        })

        it(`onTokenTransfer() - positivetest`, async () => {
            // staking token is ERC677
            const transferAmount = parseEther('1000')
            await token.connect(admin).mint(staker1.address, transferAmount)
            
            const userStakeBefore = await projectStaking.getUserStake(staker1.address)
            const projectStakeBefore = await projectStaking.getProjectStake(projectId1)
            await expect(token.connect(staker1).transferAndCall(projectStaking.address, transferAmount, projectId1))
                .to.emit(projectStaking, "Stake")
                .withArgs(projectId1, staker1.address, transferAmount)
            const userStakeAfter = await projectStaking.getUserStake(staker1.address)
            const projectStakeAfter = await projectStaking.getProjectStake(projectId1)

            expect(userStakeAfter).to.equal(userStakeBefore.add(transferAmount))
            expect(projectStakeAfter).to.equal(projectStakeBefore.add(transferAmount))
        })

        it(`onTokenTransfer() - negativetest - bad project id`, async () => {
            const transferAmount = parseEther('1')
            await token.connect(admin).mint(staker1.address, transferAmount)
            await expect(token.connect(staker1).transferAndCall(projectStaking.address, transferAmount, '0x1234')) // not bytes32
                .to.be.revertedWith("error_badProjectId")
        })

        it(`onTokenTransfer() - negativetest - non existing project`, async () => {
            const transferAmount = parseEther('1')
            await token.connect(admin).mint(staker1.address, transferAmount)
            await expect(token.connect(staker1).transferAndCall(projectStaking.address, transferAmount, nonExistingProject))
                .to.be.revertedWith("error_projectNotFound")
        })

        it(`onTokenTransfer() - negativetest - wrong staking token`, async () => {
            const transferAmount = parseEther('1')
            await token2.connect(admin).mint(staker1.address, transferAmount)
            await expect(token2.connect(staker1).transferAndCall(projectStaking.address, transferAmount, projectId1))
                .to.be.revertedWith("error_wrongStakingToken")
        })
    })
})
