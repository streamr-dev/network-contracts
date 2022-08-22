import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import EthCrypto from 'eth-crypto'
import { BigNumber, Wallet, Contract } from "ethers"

const { provider } = waffle
export type TypedValue = {
    value: string | number | BigNumber,
    type: 'string' | 'uint256' | 'int256' | 'bool' | 'bytes' | 'bytes32' | 'address'
};

const signDelegatedChallenge = async (
    main: Wallet, 
    delegated: Wallet,
    challengeType: 0 | 1 // 0 = authorize | 1 = revoke
) => {

    const message = EthCrypto.hash.keccak256([
        { type: 'uint256', value: challengeType.toString()},
        {type: 'address', value: main.address}
    ])
    const signature = EthCrypto.sign(delegated.privateKey, message)
     
    return {
        delegated, message, signature
    }
}

use(waffle.solidity)
describe('DelegatedAccessRegistry', (): void => {

    const wallets = provider.getWallets()

    const delegated = Wallet.createRandom()

    let contract: Contract

    before(async (): Promise<void> => {

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry', wallets[0])
        
        contract = await DelegatedAccessRegistry.deploy()
        contract.connect(wallets[0])

    })

    it ('should exercise the `isUserAuthorized` when not set', async () => {
        const isAuthorized = await contract.isUserAuthorized(
            wallets[0].address,
            delegated.address
        )

        expect(isAuthorized).to.equal(false)
    })

    it ('should exercise the `isAuthorized` method when not set', async () => {
        const isAuthorized = await contract.connect(wallets[0])
            .isAuthorized(
                delegated.address
            )
        expect(isAuthorized).to.equal(false)
    })

    it ('happy-path for `authorize` method', async() => {
        const { signature } = await signDelegatedChallenge(
            wallets[0], 
            delegated,
            0 // authorize type 
        )

        await contract.authorize(
            delegated.address,
            signature
        )

        const isAuthorized = await contract.isUserAuthorized(
            wallets[0].address,
            delegated.address
        )

        expect(isAuthorized).to.equal(true)

        const mainWallet = await contract.getMainWalletFor(
            delegated.address 
        )
        
        expect(mainWallet).to.equal(wallets[0].address)
    })

    it ('should exercise the `isAuthorized` method when set', async () => {
        const isAuthorized = await contract.connect(wallets[0])
            .isAuthorized(
                delegated.address
            )
        expect(isAuthorized).to.equal(true)
    })
    
    it ('happy-path for `getMainWalletFor`', async () => {
        const mainWallet = await contract.getMainWalletFor(
            delegated.address 
        )
        
        expect(mainWallet).to.equal(wallets[0].address)
    })

    it ('happy-path for `isMainWallet`', async () => {
        const isMainWallet = await contract.isMainWallet(
            wallets[0].address
        )
        
        expect(isMainWallet).to.equal(true)
    })

    it ('happy-path for `isDelegatedWallet`', async () => {
        const isDelegatedWallet = await contract.isDelegatedWallet(
            delegated.address
        )

        expect(isDelegatedWallet).to.equal(true)
    })

    it ('happy-path for `isWalletKnown`', async () => {
        const isMainWalletKnown = await contract.isWalletKnown(
            wallets[0].address
        )
        expect(isMainWalletKnown).to.equal(true)

        const isDelegatedWalletKnown = await contract.isWalletKnown(
            delegated.address

        )
        expect(isDelegatedWalletKnown).to.equal(true)
    })

    it ('happy-path for `areMainWallets`', async () => {
        const res = await contract.areMainWallets(
            [wallets[0].address, wallets[1].address]
        )
        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(false)
    })

    it ('happy-path for `areDelegatedWallets`', async () => {
        const res = await contract.areDelegatedWallets(
            [delegated.address, wallets[1].address]
        )

        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(false)
    })

    it ('happy-path for `areWalletsKnown`', async () => {
        const res = await contract.areWalletsKnown(
            [wallets[0].address, delegated.address, wallets[1].address]
        )

        expect(res[0]).to.equal(true)
        expect(res[1]).to.equal(true)
        expect(res[2]).to.equal(false)
    })

    it ('happy-path for `revoke` method', async () => {
        const { signature } = await signDelegatedChallenge(
            wallets[0],
            delegated,
            1 // revoke type
        )
        await contract.revoke(
            delegated.address,
            signature
        )

        const isAuthorized = await contract.isUserAuthorized(
            wallets[0].address,
            delegated.address
        )

        expect(isAuthorized).to.equal(false)

        const mainWallet = await contract.getMainWalletFor(
            delegated.address 
        )
        
        expect(mainWallet).to.equal('0x0000000000000000000000000000000000000000')
    })

    it ('unset value upon `getMainWalletFor`', async () => {
        const mainWallet = await contract.getMainWalletFor(
            delegated.address 
        )
        
        expect(mainWallet).to.equal('0x0000000000000000000000000000000000000000')
    })

    it ('unset value upon `isMainWallet', async () => {
        const isMainWallet = await contract.isMainWallet(
            wallets[0].address
        )
        
        expect(isMainWallet).to.equal(false)
    })

    it ('unset value upon `isDelegatedWallet`', async () => {
        const isDelegatedWallet = await contract.isDelegatedWallet(
            delegated.address
        )

        expect(isDelegatedWallet).to.equal(false)
    })

    it ('unset value upon `isWalletKnown`', async () => {
        const isMainWalletKnown = await contract.isWalletKnown(
            wallets[0].address
        )
        expect(isMainWalletKnown).to.equal(false)

        const isDelegatedWalletKnown = await contract.isWalletKnown(
            delegated.address

        )
        expect(isDelegatedWalletKnown).to.equal(false)
    })

})