
import { waffle, ethers, upgrades } from 'hardhat'
import { expect, use } from 'chai'
import EthCrypto from 'eth-crypto'
import { StreamRegistry } from '../../typechain'
import { MinimalForwarder } from '../../test-contracts/MinimalForwarder'
import { deployContract } from 'ethereum-waffle'
import ForwarderJson from '../../test-contracts/MinimalForwarder.json'
import { BigNumber, Wallet, Contract, utils, BigNumberish } from "ethers"

const { hexZeroPad, parseEther, arrayify } = utils

const { provider } = waffle
export type TypedValue = {
    value: string | Number | BigNumber,
    type: 'string' | 'uint256' | 'int256' | 'bool' | 'bytes' | 'bytes32' | 'address'
};

async function getWithdrawSignature(
    signer: Wallet,
    to: Wallet,
    amountTokenWei: BigNumberish,
    duContract: Contract
) {
    const previouslyWithdrawn = await duContract.getWithdrawn(signer.address) as BigNumber
    const message = to.address
        + hexZeroPad(BigNumber.from(amountTokenWei).toHexString(), 32).slice(2)
        + duContract.address.slice(2)
        + hexZeroPad(previouslyWithdrawn.toHexString(), 32).slice(2)
    return signer.signMessage(arrayify(message))
}

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
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

    const wallets = provider.getWallets()

    const delegated = Wallet.createRandom()

    let contract: Contract

    let signerIdentity: any 
    let message: string 
    let signature: string
    let token: Contract 


    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'
    const streamId = `${adminAddress}${streamPath}`.toLowerCase()

    let delegatedAccessRegistry: Contract

    before(async (): Promise<void> => {
        

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry', wallets[0])
        
        contract = await DelegatedAccessRegistry.deploy()
        contract.connect(wallets[0])

    })

    it ('happy-path for `authorize` method', async() => {
        const { message, signature } = await signDelegatedChallenge(
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

})