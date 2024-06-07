#!/usr/bin/env python3
import argparse
from typing import List
from typing import Optional
from typing import Set

import numpy as np
import torch
import torch.nn as nn


def make_arg_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=str, required=True)
    parser.add_argument("--split", type=float, default=0.9)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--block-size", type=int, default=48)
    parser.add_argument("--embed-size", type=int, default=128)
    parser.add_argument("--num-heads", type=int, default=8)
    parser.add_argument("--head-size", type=int, default=16)
    parser.add_argument("--num-layers", type=int, default=6)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--steps", type=int, default=20_000)
    parser.add_argument("--eval-period", type=int, default=300)
    parser.add_argument("--eval-iters", type=int, default=200)
    parser.add_argument("--seed", type=int, default=None)
    return parser


class Vocab:
    def __init__(self, vocab: Set[str]):
        self.vocab = sorted(vocab)
        self._ctoi = {c: i for i, c in enumerate(vocab)}
        self._itoc = {i: c for i, c in enumerate(vocab)}

    def encode(self, s: str) -> List[int]:
        return [self._ctoi[c] for c in s]

    def decode(self, ii: List[int]) -> str:
        return "".join(self._itoc[i] for i in ii)


class Head(nn.Module):
    def __init__(
        self,
        block_size: int,
        embed_size: int,
        head_size: int,
        dropout: float,
        device=None,
    ):
        super().__init__()
        self.key = nn.Linear(embed_size, head_size)
        self.query = nn.Linear(embed_size, head_size)
        self.value = nn.Linear(embed_size, head_size)
        self.dropout = nn.Dropout(dropout)
        # Cache
        self._invsqrt_H = head_size ** -0.5
        self._tril0 = torch.tril(torch.ones(block_size, block_size)) == 0
        self._tril0.to(device)

    def forward(self, x: torch.Tensor, y: Optional[torch.Tensor] = None):
        B, T, C = x.shape
        # B, T, H
        keys = self.key(x)
        queries = self.query(x)
        values = self.value(x)
        # B, T, T
        attentions = keys @ queries.transpose(-2, -1) * self._invsqrt_H
        attentions = attentions.masked_fill(self._tril0[:T, :T], float("-inf"))
        attentions = nn.functional.softmax(attentions, dim=-1)
        return self.dropout(attentions) @ values


class MultiHead(nn.Module):
    def __init__(
        self,
        block_size: int,
        embed_size: int,
        num_heads: int,
        head_size: int,
        dropout: float,
        device: str,
    ):
        super().__init__()
        self.heads = nn.ModuleList(
            [
                Head(block_size, embed_size, head_size, dropout, device)
                for _ in range(num_heads)
            ]
        )
        self.proj = nn.Linear(num_heads * head_size, embed_size)

    def forward(self, x: torch.Tensor, y: Optional[torch.Tensor] = None):
        return self.proj(torch.cat([h(x) for h in self.heads], dim=-1))


class FeedForward(nn.Module):
    def __init__(self, embed_size: int, inner_multiplier: int = 4):
        super().__init__()
        self.linear = nn.Linear(embed_size, inner_multiplier * embed_size)
        self.relu = nn.ReLU()
        self.proj = nn.Linear(inner_multiplier * embed_size, embed_size)

    def forward(self, x, y=None):
        return self.proj(self.relu(self.linear(x)))


class SaBlock(nn.Module):
    def __init__(
        self,
        block_size: int,
        embed_size: int,
        num_heads: int,
        head_size: int,
        dropout: float,
        device=None,
    ):
        super().__init__()
        self.ln1 = nn.LayerNorm(embed_size)
        self.multihead = MultiHead(
            block_size, embed_size, num_heads, head_size, dropout, device
        )
        self.dropout1 = nn.Dropout(dropout)
        self.ln2 = nn.LayerNorm(embed_size)
        self.ff = FeedForward(embed_size)
        self.dropout2 = nn.Dropout(dropout)

    def forward(self, x, y=None):
        x = x + self.dropout1(self.multihead(self.ln1(x)))
        return x + self.dropout2(self.ff(self.ln2(x)))


class LanguageModel(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        block_size: int,
        embed_size: int,
        num_heads: int,
        head_size: int,
        num_layers: int,
        dropout: float,
        device=None,
    ) -> None:
        super().__init__()
        self.vocab_embedding_table = nn.Embedding(vocab_size, embed_size)
        self.position_embedding_table = nn.Embedding(block_size, embed_size)
        self.blocks = nn.Sequential(
            *[
                SaBlock(block_size, embed_size, num_heads, head_size, dropout, device)
                for _ in range(num_layers)
            ]
        )
        self.ln = nn.LayerNorm(embed_size)
        self.lm_head = nn.Linear(embed_size, vocab_size)
        # Cache
        self._positions = torch.arange(block_size, device=device)

    def forward(self, xb: torch.Tensor, yb: Optional[torch.Tensor] = None):
        B, T = xb.shape
        vocab_embedding = self.vocab_embedding_table(xb)
        position_embedding = self.position_embedding_table(self._positions[:T])
        # B, T, C
        embedding = vocab_embedding + position_embedding
        # B, T, C
        logits = self.lm_head(self.ln(self.blocks(embedding)))
        if yb is not None:
            B, T, C = logits.shape
            loss = nn.functional.cross_entropy(logits.view(B * T, C), yb.view(B * T))
        else:
            loss = None
        return logits, loss

    def generate(self, seq: torch.Tensor, max_new_tokens: int) -> torch.Tensor:
        for _ in range(max_new_tokens):
            logits, _loss = self(seq[:, -self._positions.shape[0] :])  # B, T, C
            logits = logits[:, -1, :]  # B, C
            probs = nn.functional.softmax(logits, dim=-1)  # B, C
            seq_next = torch.multinomial(probs, num_samples=1)  # B, 1
            seq = torch.concat((seq, seq_next), dim=-1)  # B, T + 1
        return seq


def make_random_batch(data, block_size, batch_size, device=None):
    ii = torch.randint(len(data) - block_size, (batch_size,))
    x = torch.stack([data[i : i + block_size] for i in ii])
    y = torch.stack([data[i + 1 : i + block_size + 1] for i in ii])
    if device is not None:
        x.to(device)
        y.to(device)
    return x, y


@torch.no_grad()
def estimate_loss(model, train_data, eval_data, args, device=None):
    model.eval()
    try:
        train_loss = np.zeros((1,))
        eval_loss = np.zeros((1,))
        for data, loss_box in ((train_data, train_loss), (eval_data, eval_loss)):
            losses = np.zeros(args.eval_iters)
            for k in range(args.eval_iters):
                x, y = make_random_batch(data, args.block_size, args.batch_size, device)
                logits, loss = model(x, y)
                losses[k] = loss.item()
            loss_box[0] = losses.mean()
    finally:
        model.train()
    return train_loss[0], eval_loss[0]


def main():
    parser = make_arg_parser()
    args = parser.parse_args()

    with open(args.dataset, "r") as f:
        raw_data = f.read()

    print(f"Total dataset len: {len(raw_data)}")
    vocab = Vocab(set(raw_data))
    print(f"Vocabulary: {vocab.vocab}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device '{device}'")

    data = torch.tensor(vocab.encode(raw_data), dtype=torch.long)
    split = int(len(data) * args.split)
    train_data = data[:split]
    eval_data = data[split:]
    print(f"Train dataset len: {len(train_data)}")
    print(f"Evaluation dataset len: {len(eval_data)}")

    if args.seed is not None:
        torch.manual_seed(args.seed)

    lm = LanguageModel(
        vocab_size=len(vocab.vocab),
        block_size=args.block_size,
        embed_size=args.embed_size,
        num_heads=args.num_heads,
        head_size=args.head_size,
        num_layers=args.num_layers,
        dropout=args.dropout,
    )
    lm.to(device)
    print(f"Total model size: {sum(p.numel() for p in lm.parameters())}")
    optimizer = torch.optim.AdamW(lm.parameters(), lr=args.learning_rate)

    for i in range(args.steps):
        if i % args.eval_period == 0:
            train_loss, eval_loss = estimate_loss(
                lm, train_data, eval_data, args, device
            )
            print(f"Losses @ {i}: train = {train_loss}, eval = {eval_loss}")
        xb, yb = make_random_batch(train_data, args.block_size, args.batch_size, device)
        logits, loss = lm(xb, yb)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
    print(f"Final training loss: {loss.item()}")
    print("---")
    print(generate_sample(lm, vocab, device))


def generate_sample(m, vocab, device=None) -> str:
    seq = torch.zeros((1, 1), dtype=torch.long, device=device)
    return vocab.decode(m.generate(seq, max_new_tokens=100)[0].tolist())


if __name__ == "__main__":
    main()
