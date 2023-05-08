import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewOperator } from '../generated/OperatorFactory/OperatorFactory'
import { Operator } from '../generated/schema'
import { Operator as OperatorTemplate } from '../generated/templates'
import { updateOrCreateOperatorDailyBucket } from './helpers'

export function handleNewOperator(event: NewOperator): void {
    let contractAddress = event.params.operatorContractAddress
    let contractAddressString = contractAddress.toHexString()
    log.info('handleNewOperator: operatoraddress={} blockNumber={}', [contractAddressString, event.block.number.toString()])
    let operator = new Operator(contractAddressString)
    operator.delegatorCount = 0
    operator.approximatePoolValue = BigInt.fromI32(0)
    operator.owner = event.params.operatorAddress.toHexString()
    operator.unallocatedWei = BigInt.fromI32(0)
    operator.save()

    // update OperatorDailyBucket
    updateOrCreateOperatorDailyBucket(contractAddressString,
        event.block.timestamp,
        BigInt.fromI32(0),
        BigInt.fromI32(0),
        0,
        BigInt.fromI32(0),
        BigInt.fromI32(0))

    // Instantiate template
    OperatorTemplate.create(contractAddress)
}
