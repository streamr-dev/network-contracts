import { log } from '@graphprotocol/graph-ts'
import { Staking, Unstaking } from '../generated/schema'
import {
    Stake,
    Stake1,
    Unstake,
    Unstake1,
} from '../generated/ProjectStakingV1/ProjectStakingV1'
import { loadOrCreateProject } from './helpers'

export function handleStake(event: Stake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleStake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const stakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleStake: stakeId={}', [stakeId])

    const staking = new Staking(stakeId)
    staking.project = projectId
    staking.user = event.params.user
    staking.amount = event.params.amount
    staking.stakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = project.score!.plus(event.params.amount) || event.params.amount
    project.save()
    staking.save()
}

export function handleUnstake(event: Unstake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleUnstake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const unstakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleUnstake: unstakeId={}', [unstakeId])

    const unstaking = new Unstaking(unstakeId)
    unstaking.project = projectId
    unstaking.user = event.params.user
    unstaking.amount = event.params.amount
    unstaking.unstakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = project.score!.minus(event.params.amount)
    project.save()
    unstaking.save()
}

// Contract upgraded on 2023-04-02
// https://polygonscan.com/tx/0xfb5e20c0daf89b2fd026755d374d59b4e802ccdca6f6e3721691c0483ea9fdcd
// Stake/Unstake event signatures have changed and projectStake parameter was added

export function handleStake1(event: Stake1): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    const projectStake = event.params.projectStake
    log.info('handleStake1: projectId={} user={} amount={} projectStake={} blockNumber={}',
        [projectId, user, amount, projectStake.toString(), event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const stakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleStake1: stakeId={}', [stakeId])

    const staking = new Staking(stakeId)
    staking.project = projectId
    staking.user = event.params.user
    staking.amount = event.params.amount
    staking.stakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = projectStake
    project.save()
    staking.save()
}

export function handleUnstake1(event: Unstake1): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    const projectStake = event.params.projectStake
    log.info('handleUnstake1: projectId={} user={} amount={} projectStake={} blockNumber={}',
        [projectId, user, amount, projectStake.toString(), event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const unstakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleUnstake1: unstakeId={}', [unstakeId])

    const unstaking = new Unstaking(unstakeId)
    unstaking.project = projectId
    unstaking.user = event.params.user
    unstaking.amount = event.params.amount
    unstaking.unstakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = projectStake
    project.save()
    unstaking.save()
}
