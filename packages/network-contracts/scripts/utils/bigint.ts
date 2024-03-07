#!/usr/bin/env npx ts-node

import assert from "assert"

/** Multiply bigint by decimal string, round down */
export function mul(a: bigint, f: string): bigint {
    if (isNaN(parseFloat(f))) { throw new Error("Invalid float: " + f) }
    const [int, dec] = f.split(".")
    if (!dec) {
        return a * BigInt(int)
    }
    const scale = BigInt(10 ** dec.length)
    return (a * (BigInt(int) * scale + BigInt(dec))) / scale
}

/** Divide bigint by decimal string, round down */
export function div(a: bigint, f: string): bigint {
    if (isNaN(parseFloat(f))) { throw new Error("Invalid float: " + f) }
    const [int, dec] = f.split(".")
    if (!dec) {
        return a * BigInt(int)
    }
    const scale = BigInt(10 ** dec.length)
    return (a * scale * scale / (BigInt(int) * scale + BigInt(dec))) / scale
}

if (require.main === module) {
    // mul tests
    assert.equal(mul(BigInt(10), "1"), BigInt(10))
    assert.equal(mul(BigInt(10), "1.5"), BigInt(15))
    assert.equal(mul(BigInt(10), "1.23456"), BigInt(12))
    // assert.equal(mul(87_000_000n, "1.15"), 100_050_000n) // requires ES2020 target
    assert.equal(mul(
        BigInt("123547812635841762534876235481623548761235487126354"),
        "1.00123451823674517826354871623548716253481672354"
    ),  BigInt("123700334663650685555733683594902667410667690513434"))

    // div tests
    assert.equal(div(BigInt(10), "1"), BigInt(10))
    assert.equal(div(BigInt(10), "1.25"), BigInt(8))
    assert.equal(div(BigInt(1000), "1.11111"), BigInt(900))
    // assert.equal(div(100_050_000n, "1.15"), 87_000_000n)
    assert.equal(div(
        BigInt("123700334663650685555733683594902667410667690513434"),
        "1.00123451823674517826354871623548716253481672354"
    ),  BigInt("123547812635841762534876235481623548761235487126353"))
    console.log("[OK]")
}
