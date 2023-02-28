import { ethers } from 'hardhat'
import { expect } from 'chai'
import EthCrypto from 'eth-crypto'
import { BigNumber, Wallet, Contract, Signer } from 'ethers'

export type TypedValue = {
    value: string | number | BigNumber
    type: 'string' | 'uint256' | 'int256' | 'bool' | 'bytes' | 'bytes32' | 'address'
}

const signDelegatedChallenge = async (
    main: Wallet,
    delegated: Wallet,
    challengeType: 0 | 1 // 0 = authorize | 1 = revoke
) => {
    const message = EthCrypto.hash.keccak256([
        { type: 'uint256', value: challengeType.toString() },
        { type: 'address', value: main.address },
    ])
    const signature = EthCrypto.sign(delegated.privateKey, message)

    return {
        delegated,
        message,
        signature,
    }
}

describe('DelegatedAccessRegistry', async (): Promise<void> => {
    let wallets: Signer[]

    const delegated = Wallet.createRandom()

    let contract: Contract

    const mockPolicyAddress = '0x1234567890123456789012345678901234567890'

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()

        const DelegatedAccessRegistry = await ethers.getContractFactory(
            'DelegatedAccessRegistry',
            wallets[0]
        )

        contract = await DelegatedAccessRegistry.deploy()
        contract.connect(wallets[0])
    })

    it('should exercise the `isUserAuthorized` when not set', async () => {
        const isAuthorized = await contract.isUserAuthorized(
            await wallets[0].getAddress(),
            delegated.address
        )

        expect(isAuthorized).to.equal(false)
    })

    it('should exercise the `isAuthorized` method when not set', async () => {
        const isAuthorized = await contract.connect(wallets[0]).isAuthorized(delegated.address)
        expect(isAuthorized).to.equal(false)
    })

    it('happy-path for `authorize` method', async () => {
        const { signature } = await signDelegatedChallenge(
            wallets[0],
            delegated,
            0 // authorize type
        )

        await contract.authorize(delegated.address, signature)

        const isAuthorized = await contract.isUserAuthorized(wallets[0].address, delegated.address)

        expect(isAuthorized).to.equal(true)

        const mainWallet = await contract.getMainWalletFor(delegated.address)

        expect(mainWallet).to.equal(wallets[0].address)
    })

    it('should exercise the `isAuthorized` method when set', async () => {
        const isAuthorized = await contract.connect(wallets[0]).isAuthorized(delegated.address)
        expect(isAuthorized).to.equal(true)
    })

    it('happy-path for `getMainWalletFor`', async () => {
        const mainWallet = await contract.getMainWalletFor(delegated.address)

        expect(mainWallet).to.equal(wallets[0].address)
    })

    it('happy-path for `getDelegatedWalletFor`', async () => {
        const delegatedWallet = await contract.getDelegatedWalletFor(wallets[0].address)

        expect(delegatedWallet).to.equal(delegated.address)
    })

    it('happy-path for `isMainWallet`', async () => {
        const isMainWallet = await contract.isMainWallet(wallets[0].address)

        expect(isMainWallet).to.equal(true)
    })

    it('happy-path for `isDelegatedWallet`', async () => {
        const isDelegatedWallet = await contract.isDelegatedWallet(delegated.address)

        expect(isDelegatedWallet).to.equal(true)
    })

    it('happy-path for `isWalletKnown`', async () => {
        const isMainWalletKnown = await contract.isWalletKnown(wallets[0].address)
        expect(isMainWalletKnown).to.equal(true)

        const isDelegatedWalletKnown = await contract.isWalletKnown(delegated.address)
        expect(isDelegatedWalletKnown).to.equal(true)
    })

    it('happy-path for `areMainWallets`', async () => {
        const res = await contract.areMainWallets([wallets[0].address, wallets[1].address])
        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(false)
    })

    it('happy-path for `areDelegatedWallets`', async () => {
        const res = await contract.areDelegatedWallets([delegated.address, wallets[1].address])

        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(false)
    })

    it('happy-path for `areWalletsKnown`', async () => {
        const res = await contract.areWalletsKnown([
            wallets[0].address,
            delegated.address,
            wallets[1].address,
        ])

        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(true)
        expect(res[2]).to.equal(false)
    })

    it('happy-path for `revoke` method', async () => {
        const { signature } = await signDelegatedChallenge(
            wallets[0],
            delegated,
            1 // revoke type
        )
        await contract.revoke(delegated.address, signature)

        const isAuthorized = await contract.isUserAuthorized(wallets[0].address, delegated.address)

        expect(isAuthorized).to.equal(false)

        const mainWallet = await contract.getMainWalletFor(delegated.address)

        expect(mainWallet).to.equal('0x0000000000000000000000000000000000000000')
    })

    it('unset value upon `getMainWalletFor`', async () => {
        const mainWallet = await contract.getMainWalletFor(delegated.address)

        expect(mainWallet).to.equal('0x0000000000000000000000000000000000000000')
    })

    it('unset value upon `isMainWallet', async () => {
        const isMainWallet = await contract.isMainWallet(wallets[0].address)

        expect(isMainWallet).to.equal(false)
    })

    it('unset value upon `isDelegatedWallet`', async () => {
        const isDelegatedWallet = await contract.isDelegatedWallet(delegated.address)

        expect(isDelegatedWallet).to.equal(false)
    })

    it('unset value upon `isWalletKnown`', async () => {
        const isMainWalletKnown = await contract.isWalletKnown(wallets[0].address)
        expect(isMainWalletKnown).to.equal(false)

        const isDelegatedWalletKnown = await contract.isWalletKnown(delegated.address)
        expect(isDelegatedWalletKnown).to.equal(false)
    })

    // test coverage
    it('should trigger an error when a signature with invalid length is provided to `verifyDelegationChallenge`', async () => {
        try {
            const { signature } = await signDelegatedChallenge(
                wallets[0],
                delegated,
                0 // authorize type
            )

            await contract.authorize(delegated.address, signature.slice(0, -2))
        } catch (e: any) {
            expect(e.message).to.equal(
                "VM Exception while processing transaction: reverted with reason string 'error_badSignatureLength'"
            )
        }
    })

    // test coverage
    it("should trigger an error when the signature's version is wrong", async () => {
        try {
            const { signature } = await signDelegatedChallenge(
                wallets[0],
                delegated,
                0 // authorize type
            )

            // trick the version number in the formatted signature
            const mockSignature = signature.slice(0, -2) + '02'

            await contract.authorize(delegated.address, mockSignature)
        } catch (e: any) {
            expect(e.message).to.equal(
                "VM Exception while processing transaction: reverted with reason string 'error_badSignatureVersion'"
            )
        }
    })

    // test coverage
    it('should trigger the require when invalid signature provided to `revoke` method', async () => {
        try {
            const { signature } = await signDelegatedChallenge(
                wallets[0],
                delegated,
                1 // revoke type
            )
            await contract.revoke(delegated.address, signature.slice(0, -2))
        } catch (e: any) {
            expect(e.message).to.equal(
                "VM Exception while processing transaction: reverted with reason string 'error_badSignatureLength'"
            )
        }
    })

    it('should exercise `addPolicyToWallet`, happy-path', async () => {
        const tx = await contract.connect(wallets[0]).addPolicyToWallet(mockPolicyAddress)

        expect(tx.from).to.equal(wallets[0].address)
        expect(tx.to).to.equal(contract.address)
        expect(tx.data).to.equal(
            contract.interface.encodeFunctionData('addPolicyToWallet', [mockPolicyAddress])
        )
    })

    it('should exercise the `getPoliciesForWallet` method and return the mockPolicyAddress', async () => {
        const policies = await contract.getPoliciesForWallet(wallets[0].address)
        expect(policies.length).to.equal(1)
        expect(policies[0]).to.equal(mockPolicyAddress)
    })

    it('should exercise `removePolicyFromWallet`, happy-path', async () => {
        const tx = await contract.connect(wallets[0]).removePolicyFromWallet(mockPolicyAddress)

        expect(tx.from).to.equal(wallets[0].address)
        expect(tx.to).to.equal(contract.address)

        expect(tx.data).to.equal(
            contract.interface.encodeFunctionData('removePolicyFromWallet', [mockPolicyAddress])
        )
    })

    it('should exercise `getPoliciesForWallet` method and return an empty array', async () => {
        const policies = await contract.getPoliciesForWallet(wallets[0].address)
        expect(policies.length).to.equal(0)
    })

    // test coverage completion
    it('should exercise `removePolicyFromWallet` method without finding any results', async () => {
        const nonExistentContractAddress = '0x12556593e5677017e65e2bF71eaA4D152Ed9B295'
        const tx = await contract.removePolicyFromWallet(nonExistentContractAddress)
        expect(tx.from).to.equal(wallets[0].address)
        expect(tx.to).to.equal(contract.address)
        expect(tx.data).to.equal(
            contract.interface.encodeFunctionData('removePolicyFromWallet', [
                nonExistentContractAddress,
            ])
        )
    })
})
