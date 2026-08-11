"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/format";
import {
  searchSepoliaTokens,
  type TestnetToken,
} from "@/lib/testnet-token-catalog";

interface TokenCatalogPickerProps {
  selectedAddresses: readonly string[];
  onSelect: (token: TestnetToken) => void;
}

export function TokenCatalogPicker({
  selectedAddresses,
  onSelect,
}: TokenCatalogPickerProps) {
  const [query, setQuery] = useState("");
  const selected = new Set(
    selectedAddresses.map((address) => address.toLowerCase()),
  );
  const matches = searchSepoliaTokens(query);

  return (
    <section className="token-picker" aria-labelledby="token-picker-title">
      <div className="token-picker-heading">
        <div>
          <span className="section-label">Popular on Sepolia</span>
          <h3 id="token-picker-title">Find a token to monitor</h3>
        </div>
        <span className="token-picker-network">Sepolia only</span>
      </div>
      <label className="form-field token-search">
        <span>Search tokens</span>
        <input
          type="search"
          value={query}
          placeholder="Search USDC, LINK, WETH…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="token-results">
        {matches.map((token) => {
          const added = selected.has(token.address.toLowerCase());
          return (
            <button
              type="button"
              className="token-result"
              disabled={added}
              onClick={() => onSelect(token)}
              key={token.address}
            >
              <span className="token-result-mark" aria-hidden="true">
                {token.symbol.slice(0, 1)}
              </span>
              <span className="token-result-copy">
                <strong>{token.symbol}</strong>
                <small>
                  {token.name} · {shortAddress(token.address, 6, 4)}
                </small>
              </span>
              <span className={added ? "verified" : "token-add-action"}>
                {added ? "Added" : "+ Add"}
              </span>
            </button>
          );
        })}
        {matches.length === 0 && (
          <p className="asset-empty">
            No curated Sepolia token matches that search.
          </p>
        )}
      </div>
      <p className="trust-note">
        Preset addresses are checked against each issuer’s official deployment.
        Testnet tokens have no monetary value.
      </p>
    </section>
  );
}
