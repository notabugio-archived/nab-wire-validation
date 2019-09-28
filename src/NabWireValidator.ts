import { sign } from "@notabug/gun-sear"
import { Validation } from "@notabug/peer"
import socketCluster from "socketcluster-client"
import Gun from "gun"

const DEFAULT_OPTS = {
  socketCluster: {
    hostname: process.env.GUN_SC_HOST || "localhost",
    port: process.env.GUN_SC_PORT || "4444",
    autoReconnect: true,
    autoReconnectOptions: {
      initialDelay: 1,
      randomness: 100,
      maxDelay: 500
    }
  }
}

export class NabWireValidator {
  suppressor: any
  socket: any

  constructor(options = DEFAULT_OPTS) {
    this.suppressor = Validation.createSuppressor(Gun)
    this.socket = socketCluster.create(options.socketCluster)
    this.socket.on("connect", this.onConnected.bind(this))
    this.socket.on("error", err => {
      console.error("SC Connection Error", err.stack, err)
    })

    this.validateGets()
    this.validatePuts()
  }

  onConnected() {
    if (process.env.GUN_SC_PUB && process.env.GUN_SC_PRIV) {
      this.authenticate(process.env.GUN_SC_PUB, process.env.GUN_SC_PRIV)
        .then(() => console.log(`Logged in as ${process.env.GUN_SC_PUB}`))
        .catch(err => console.error("Error logging in:", err.stack || err))
    } else {
      console.error("Missing GUN_SC_PUB/GUN_SC_PRIV env variables")
      process.exit(1)
    }
  }

  authenticate(pub: string, priv: string) {
    const id = this.socket!.id
    const timestamp = new Date().getTime()
    const challenge = `${id}/${timestamp}`

    return sign(challenge, { pub, priv }, { raw: true }).then(
      proof =>
        new Promise((ok, fail) => {
          this.socket!.emit(
            "login",
            {
              pub,
              proof
            },
            (err: any) => (err ? fail(err) : ok())
          )
        })
    )
  }

  validateGets() {
    const channel = this.socket.subscribe("gun/get", { waitForAuth: true })
    channel.on("subscribe", () => {
      channel.watch(this.onReceiveGet.bind(this))
    })
  }

  validatePuts() {
    const channel = this.socket.subscribe("gun/put", { waitForAuth: true })
    channel.on("subscribe", () => {
      channel.watch(this.onReceivePut.bind(this))
    })
  }

  onReceiveGet(msg: any) {
    this.suppressor
      .validate(msg)
      .then(isValid => {
        if (isValid) {
          this.socket.publish("gun/get/validated", msg)
        } else {
          throw new Error("Invalid get")
        }
      })
      .catch(error =>
        console.error("Error validating get", error.stack || error, msg)
      )
  }

  onReceivePut(msg: any) {
    this.suppressor
      .validate(msg)
      .then(isValid => {
        if (isValid) {
          this.socket.publish("gun/put/validated", msg)
        } else {
          throw new Error("Invalid put")
        }
      })
      .catch(error =>
        console.error("Error validating put", error.stack || error, msg)
      )
  }
}
