import { Transaction, Capability } from "@ethereumjs/tx";
import Common from "@ethereumjs/common";
import { fromRpcSig } from "ethereumjs-util";

class TransactionHelper extends Transaction {
	async signViaProvider(provider: SponsoringProvider, sender: string) {
		// Hack for the constellation that we have got a legacy tx after spuriousDragon with a non-EIP155 conforming signature
		// and want to recreate a signature (where EIP155 should be applied)
		// Leaving this hack lets the legacy.spec.ts -> sign(), verifySignature() test fail
		// 2021-06-23
		let hackApplied = false;
		if (
			this.type === 0 &&
			this.common.gteHardfork("spuriousDragon") &&
			!this.supports(Capability.EIP155ReplayProtection)
		) {
			this.activeCapabilities.push(Capability.EIP155ReplayProtection);
			hackApplied = true;
		}

		const msgHash = this.getMessageToSign(true);
		const rpcSig = await provider.request({
			method: "eth_sign",
			params: [sender, msgHash]
		});
		const { v, r, s } = fromRpcSig(rpcSig);
		const tx = this._processSignature(v, r, s);

		// Hack part 2
		if (hackApplied) {
			const index = this.activeCapabilities.indexOf(
				Capability.EIP155ReplayProtection
			);
			if (index > -1) {
				this.activeCapabilities.splice(index, 1);
			}
		}

		return tx;
	}
}

export default class SponsoringProvider {
	#real: any;

	/**
	 * @param real provider, to which all requests would be
	 * redirected after interception
	 */
	constructor(real: any) {
		this.#real = real;
		if ("isMetaMask" in real) {
			(this as any).isMetaMask = real.isMetaMask;
		}
		if ("_metamask" in real) {
			(this as any)._metamask = real._metamask;
		}
	}
	async request(args: any) {
		if (args.method === "eth_sendTransaction") {
			const txParams = args.params[0];
			if (!txParams.nonce) {
				txParams.nonce = await this.#real.request({
					method: "eth_getTransactionCount",
					params: [txParams.from, "latest"]
				});
			}
			if (!txParams.gasPrice) {
				txParams.gasPrice = await this.#real.request({
					method: "eth_gasPrice"
				});
			}
			txParams.gasLimit = txParams.gas;
			delete txParams.gas;

			const chainIdHex = await this.#real.request({
				method: "eth_chainId",
				params: []
			});
			const chainId = parseInt(chainIdHex.slice(2), 16);

			const txUnsigned = new TransactionHelper(txParams, {
				common: Common.custom({ chainId })
			});

			const tx = await txUnsigned.signViaProvider(this, txParams.from);
			const rawTx = "0x" + tx.serialize().toString("hex");

			return this.#real.request({
				method: "eth_sendRawTransaction",
				params: [rawTx]
			});
		} else {
			return this.#real.request(args);
		}
	}
	requestAsync(args: any, cb: any) {
		this.request(args)
			.then((v) => cb(null, v))
			.catch(cb);
	}

	on(event: any, listener: any) {
		return this.#real.on(event, listener);
	}
	removeListener(event: any, listener: any) {
		return this.#real.removeListener(event, listener);
	}

	// Deprecated
	send() {
		throw new Error("send method is deprecated");
	}
	sendAsync() {
		throw new Error("send method is deprecated");
	}
	isConnected() {
		return this.#real.isConnected();
	}
	get chainId() {
		return this.#real.chainId;
	}
	get networkVersion() {
		return this.#real.networkVersion;
	}
	get selectedAddress() {
		return this.#real.selectedAddress;
	}
	enable() {
		return this.#real.enable();
	}
}
