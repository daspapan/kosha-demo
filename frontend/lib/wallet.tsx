"use client";

// Wallet connection and sign-in, shared by every page through React context.
// Uses the browser wallet (MetaMask) directly through ethers. No extra wallet library.

import { 
  createContext, 
  useCallback, 
  useContext, 
  useEffect, 
  useMemo, 
  useState, 
  type ReactNode 
} from "react";
import { 
  BrowserProvider, 
  JsonRpcProvider, 
  getAddress, 
  type Eip1193Provider, 
  type JsonRpcSigner 
} from "ethers";
import { DEMO_MODE } from "./demoAccounts";
import useSWR from "swr";
import { api, fetcher } from "./api";
import type { Roles } from "./types";

type InjectedProvider = Eip1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

export type WalletStatus = "loading" | "no-wallet" | "disconnected" | "wrong-network" | "connected";

type WalletContextValue = {
  status: WalletStatus;
  account: string | null;
  chainId: number | null;
  roles: Roles | null;
  token: string | null; // backend session after sign-in
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  getSigner: () => Promise<JsonRpcSigner>;
  refreshRoles: () => void;
  actAs: (address: string) => void; // demo mode only: become another person with one click
};

const WalletContext = createContext<WalletContextValue | null>(null);

const sessionKey = (address: string) => `kosha.session.${address.toLowerCase()}`;

function readSession(address: string): string | null {
  try {
    return window.localStorage.getItem(sessionKey(address));
  } catch {
    return null; // storage can be blocked; the user just signs in again
  }
}

function writeSession(address: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(sessionKey(address), token);
    else window.localStorage.removeItem(sessionKey(address));
  } catch {
    /* ignore */
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Roles are public on-chain facts, so we can read them before sign-in
  const { data: roles, mutate: refreshRoles } = useSWR<Roles>(account ? [`/address/${account}/roles`, null] : null, fetcher, { refreshInterval: 15000 });

  // Pick up an already-connected wallet and follow account / network changes
  useEffect(() => {
    // Demo mode: no MetaMask. Start as the person picked last time.
    if (DEMO_MODE) {
      setHasWallet(true);
      setChainId(EXPECTED_CHAIN_ID);
      const saved = window.localStorage.getItem("kosha.demoAccount");
      if (saved) setAccount(saved);
      return;
    }
    const eth = window.ethereum;
    setHasWallet(Boolean(eth));
    if (!eth) return;

    const onAccounts = (...args: unknown[]) => {
      const list = args[0] as string[];
      const next = list?.[0] ?? null;
      setAccount(next ? normalise(next) : null);
      setToken(next ? readSession(normalise(next)) : null);
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0] as string));

    eth.request({ method: "eth_accounts" }).then((a) => onAccounts(a)).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((c) => onChain(c)).catch(() => {});
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask in this browser.");
    const list = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const next = normalise(list[0]);
    setAccount(next);
    setToken(readSession(next));
    setChainId(Number(await window.ethereum.request({ method: "eth_chainId" })));
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    const hex = "0x" + EXPECTED_CHAIN_ID.toString(16);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch {
      // The wallet does not know this chain yet: add it, then it switches automatically
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: "Kosha local chain", rpcUrls: [RPC_URL], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
      });
    }
  }, []);

  const getSigner = useCallback(async () => {
    // Demo mode: the local Hardhat node signs for its own test accounts, so there is no pop-up
    if (DEMO_MODE) {
      if (!account) throw new Error("Pick a person first.");
      return new JsonRpcProvider(RPC_URL).getSigner(account);
    }
    if (!window.ethereum) throw new Error("No wallet found.");
    return new BrowserProvider(window.ethereum).getSigner();
  }, [account]);

  const signIn = useCallback(async () => {
    if (!account) throw new Error("Connect a wallet first.");
    const { message } = await api<{ message: string }>("/auth/nonce", { method: "POST", body: { address: account } });
    const signer = await getSigner();
    const signature = await signer.signMessage(message);
    const res = await api<{ token: string }>("/auth/verify", { method: "POST", body: { address: account, signature } });
    writeSession(account, res.token);
    setToken(res.token);
    refreshRoles();
  }, [account, getSigner, refreshRoles]);

  // Demo mode: switch person. The effect below signs them in.
  const actAs = useCallback((address: string) => {
    window.localStorage.setItem("kosha.demoAccount", address);
    setAccount(address);
    setToken(null);
  }, []);

  // Demo mode: sign in by itself whenever the person changes (no pop-up, it takes a moment)
  useEffect(() => {
    if (DEMO_MODE && account && !token) signIn().catch(() => {});
  }, [account, token, signIn]);

  const signOut = useCallback(() => {
    if (account) writeSession(account, null);
    setToken(null);
  }, [account]);

  let status: WalletStatus = "connected";
  if (hasWallet === null) status = "loading";
  else if (!hasWallet) status = "no-wallet";
  else if (!account) status = "disconnected";
  else if (chainId !== null && chainId !== EXPECTED_CHAIN_ID) status = "wrong-network";

  const value = useMemo<WalletContextValue>(
    () => ({ status, account, chainId, roles: roles ?? null, token, connect, switchNetwork, signIn, signOut, getSigner, refreshRoles: () => refreshRoles(), actAs }),
    [status, account, chainId, roles, token, connect, switchNetwork, signIn, signOut, getSigner, refreshRoles, actAs],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

function normalise(address: string): string {
  // Checksummed form, so it matches what the backend returns
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}
