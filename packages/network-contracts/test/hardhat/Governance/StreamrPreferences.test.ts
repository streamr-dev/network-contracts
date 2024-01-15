import { upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { deployStreamrConfig } from "../OperatorTokenomics/deployTestContracts"

import type { ContractFactory, Wallet } from "ethers"
import type { StreamrPreferences, StreamrConfig } from "../../../typechain"

const { getSigners, getContractFactory } = hardhatEthers

describe("StreamrPreferences", (): void => {
    let admin: Wallet
    let notAdmin: Wallet
    let streamrConfig: StreamrConfig
    let preferences: StreamrPreferences

    before(async (): Promise<void> => {
        [admin, notAdmin] = await getSigners() as Wallet[]
        streamrConfig = await deployStreamrConfig(admin)
        const contractFactory = await getContractFactory("StreamrPreferences", admin)
        preferences = await (await upgrades.deployProxy(contractFactory, [
            streamrConfig.address
        ], { kind: "uups" })).deployed() as StreamrPreferences
    })

    describe("UUPS upgradeability", () => {
        let upgraderRole: string
        let contractFactory: ContractFactory

        before(async () => {
            upgraderRole = await preferences.ADMIN_ROLE()
            contractFactory = await getContractFactory("StreamrPreferences", notAdmin)
        })

        it("does not allow upgrade without UPGRADER_ROLE", async () => {
            await expect(upgrades.upgradeProxy(preferences.address, contractFactory))
                .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${upgraderRole.toLowerCase()}`)
        })

        it("allows upgrade with UPGRADER_ROLE", async () => {
            await (await preferences.grantRole(upgraderRole, notAdmin.address)).wait()

            const newPreferences = await upgrades.upgradeProxy(preferences.address, contractFactory) as StreamrPreferences
            await newPreferences.deployed()
            expect(preferences.address).to.equal(newPreferences.address)

            await (await preferences.revokeRole(upgraderRole, notAdmin.address)).wait()
        })

        it("storage is preserved after the upgrade", async () => {
            const prefsBefore = await preferences.delegatorPreferences(notAdmin.address)
            const willDelegateBefore = prefsBefore.and("1").eq("0") // zero means delegate (default)
            await (await preferences.connect(notAdmin).setDelegateVote(false)).wait()

            const newCF = await getContractFactory("StreamrPreferences") // this the upgraded version (e.g. StreamrPreferencesV2)
            const upgradeTx = await upgrades.upgradeProxy(preferences.address, newCF)
            const newPreferences = await upgradeTx.deployed() as StreamrPreferences

            const prefsAfter = await newPreferences.delegatorPreferences(notAdmin.address)
            const willDelegateAfter = prefsAfter.and("1").eq("0") // zero means delegate (default)
            expect(willDelegateAfter).to.equal(false)

            // restore the slashingFraction modification
            await (await preferences.connect(notAdmin).setDelegateVote(willDelegateBefore)).wait()
        })

        it("reverts if trying to call initialize()", async () => {
            await expect(preferences.initialize("0x0000000000000000000000000000000000000000"))
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })

    describe("Opt-out from Snapshot vote delegation", (): void => {
        it("saves the will-delegate-vote preference", async (): Promise<void> => {
            const prefsBefore = await preferences.delegatorPreferences(notAdmin.address)
            const willDelegateBefore = prefsBefore.and("1").eq("0") // zero means delegate (default)

            await expect(preferences.connect(notAdmin).setDelegateVote(false))
                .to.emit(preferences, "DelegatorPreferencesUpdated").withArgs(notAdmin.address, "0x1", "0x1")

            const prefsAfter = await preferences.delegatorPreferences(notAdmin.address)
            const willDelegateAfter = prefsAfter.and("1").eq("0") // zero means delegate (default)

            await expect(preferences.connect(notAdmin).setDelegateVote(true))
                .to.emit(preferences, "DelegatorPreferencesUpdated").withArgs(notAdmin.address, "0x0", "0x1")

            const prefsAfter2 = await preferences.delegatorPreferences(notAdmin.address)
            const willDelegateAfter2 = prefsAfter2.and("1").eq("0") // zero means delegate (default)

            expect(willDelegateBefore).to.equal(true)
            expect(willDelegateAfter).to.equal(false)
            expect(willDelegateAfter2).to.equal(true)

            // restore the slashingFraction modification
            await (await preferences.connect(notAdmin).setDelegateVote(willDelegateBefore)).wait()
        })
    })

    describe("Access control", (): void => {
        it("prevents calling initialize", async (): Promise<void> => {
            await expect(preferences.initialize("0x0000000000000000000000000000000000000000"))
                .to.be.revertedWith("Initializable: contract is already initialized")
            await expect(preferences.connect(notAdmin).initialize("0x0000000000000000000000000000000000000000"))
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
})
