import { Address, log } from '@graphprotocol/graph-ts'
import { NewOperator, VoterUpdate } from '../generated/OperatorFactory/OperatorFactory'
import { Operator as OperatorTemplate } from '../generated/templates'
import { loadOrCreateNetwork, loadOrCreateOperator } from './helpers'

export function handleNewOperator(event: NewOperator): void {
    const contractAddress = event.params.operatorContractAddress
    log.info('handleNewOperator: operatorAddress={} blockNumber={}', [contractAddress.toHexString(), event.block.number.toString()])

    // Instantiate template
    OperatorTemplate.create(contractAddress)

    const operator = loadOrCreateOperator(contractAddress)
    operator.save()
    log.info('handleNewOperator: operatorId={}', [operator.id])

    const network = loadOrCreateNetwork()
    network.operatorsCount = network.operatorsCount + 1
    network.save()
}

export function handleVoterUpdate(event: VoterUpdate): void {
    const voterRegistryAddress = event.address.toHexString()
    const voter = event.params.voterAddress.toHexString()
    const isVoter = event.params.isVoter
    log.info('handleVoterUpdate: voterRegistryAddress={} voterAddress={} isVoter={} blockNumber={}',
        [voterRegistryAddress, voter, isVoter.toString(), event.block.number.toString()])

    const operator = loadOrCreateOperator(Address.fromString(voter))
    operator.isEligibleToVote = isVoter
    operator.save()

    const network = loadOrCreateNetwork()
    network.eligibleVotersCount += isVoter ? 1 : -1
    network.save()
}
