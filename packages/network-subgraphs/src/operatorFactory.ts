import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewOperator } from '../generated/OperatorFactory/OperatorFactory'
import { Operator, OperatorDailyBucket } from '../generated/schema'
import { Operator as OperatorTemplate } from '../generated/templates'

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
    let date = new Date(event.block.timestamp.toI32() * 1000)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    let dayDate = date.toISOString().split('T')[0]
    let bucketId = contractAddressString + "-" + dayDate.toString()
    let bucket = OperatorDailyBucket.load(bucketId)
    if (bucket === null) {
        bucket = new OperatorDailyBucket(bucketId)
        bucket.operator = contractAddressString
        bucket.date = new BigInt(i32(date.getTime()))
        bucket.approximatePoolValue = BigInt.fromI32(0)
        bucket.totalPayoutsCumulative = BigInt.fromI32(0)
        bucket.delegatorCount = 0
        bucket.spotAPY = BigInt.fromI32(0)
        bucket.totalDelegatedWei = BigInt.fromI32(0)
        bucket.unallocatedWei = BigInt.fromI32(0)
        bucket.totalStakedWei = BigInt.fromI32(0)
    }
    bucket.save()

    // Instantiate template
    OperatorTemplate.create(contractAddress)
}
