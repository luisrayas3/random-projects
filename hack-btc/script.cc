/*
g++ -std=c++11 -o btc-check ./script.cc -O3 \
    -I/Users/luis/software/brew/include \
    -L/Users/luis/software/brew/lib \
    -lssl -lcrypto -lsecp256k1
*/
#include <array>
#include <cassert>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <openssl/hmac.h>
#include <openssl/ripemd.h>
#include <openssl/sha.h>
#include <secp256k1.h>
#include <string>
#include <vector>


// 1 version + 20 hash + 4 checksum
using LegacyBtcAddr = std::array<uint8_t, 25>;

// Forward declarations
class HDKey;
std::vector<uint8_t> hmac_sha512(std::vector<uint8_t> const& key,
                                 std::vector<uint8_t> const& data);
std::vector<uint8_t> sha256(std::vector<uint8_t> const& input);
std::vector<uint8_t> hash160(std::vector<uint8_t> const& input);

// Global secp256k1 context
secp256k1_context* ctx = nullptr;

class HDKey {
  std::vector<uint8_t> private_key;
  std::vector<uint8_t> chain_code;
  std::vector<uint8_t> public_key;

public:
  static HDKey from_seed(std::vector<uint8_t> const& seed) {
    // Generate master key from seed using HMAC-SHA512
    auto hmac =
      hmac_sha512(std::vector<uint8_t>(
        {'B', 'i', 't', 'c', 'o', 'i', 'n', ' ', 's', 'e', 'e', 'd'}), seed);

    // Split into master key and chain code
    auto const private_key = std::vector<uint8_t>(hmac.begin(), hmac.begin() + 32);
    auto const chain_code = std::vector<uint8_t>(hmac.begin() + 32, hmac.end());

    if (!secp256k1_ec_seckey_verify(ctx, private_key.data())) {
      throw std::runtime_error("Invalid private key generated from seed");
    }

    return HDKey(private_key, chain_code);
  }

  HDKey(std::vector<uint8_t> const& private_key_,
        std::vector<uint8_t> const& chain_code_ = std::vector<uint8_t>(32, 0))
    : private_key(private_key_), chain_code(chain_code_) {

    // Generate public key
    secp256k1_pubkey pubkey;
    if (!secp256k1_ec_pubkey_create(ctx, &pubkey, private_key.data())) {
      throw std::runtime_error("Failed to create public key");
    }

    public_key.resize(33);
    size_t pubkey_len = 33;
    secp256k1_ec_pubkey_serialize(ctx, public_key.data(), &pubkey_len, &pubkey,
                                  SECP256K1_EC_COMPRESSED);
    assert(pubkey_len == 33);
  }

  HDKey derive_child(uint32_t index) const {
    // Prepare data for HMAC
    std::vector<uint8_t> data;
    if (index >= 0x80000000) { // Hardened
      data.push_back(0x00);    // Private key padding
      data.insert(data.end(), private_key.begin(), private_key.end());
    } else {
      data.insert(data.end(), public_key.begin(), public_key.end());
    }

    // Append index in big-endian
    data.push_back((index >> 24) & 0xFF);
    data.push_back((index >> 16) & 0xFF);
    data.push_back((index >> 8) & 0xFF);
    data.push_back(index & 0xFF);

    // Calculate I
    auto I = hmac_sha512(chain_code, data);

    // Split I into I_L and I_R
    std::vector<uint8_t> I_L(I.begin(), I.begin() + 32);
    std::vector<uint8_t> I_R(I.begin() + 32, I.end());

    // Create child HDKey with tweaked private key
    std::vector<uint8_t> child_private_key = private_key;
    if (!secp256k1_ec_seckey_tweak_add(ctx, child_private_key.data(), I_L.data())) {
        throw std::runtime_error("Invalid child key - retry with next index");
    }

    // Then create new HDKey properly with the derived keys
    HDKey child_key(child_private_key);
    child_key.chain_code = I_R;
    return child_key;
  }

  LegacyBtcAddr get_address() const {
    // Generate legacy BTC address from public key
    auto h160 = hash160(public_key);

    // Add version byte (0x00 for legacy address)
    std::vector<uint8_t> with_version;
    with_version.push_back(0x00);
    with_version.insert(with_version.end(), h160.begin(), h160.end());

    LegacyBtcAddr result{};
    result[0] = 0x00;  // Version byte
    std::copy(h160.begin(), h160.end(), result.begin() + 1);

    // Double SHA256 for checksum
    auto checksum = sha256(sha256({result.begin(), result.begin() + 21}));
    // Add first 4 bytes of checksum
    std::copy(checksum.begin(), checksum.begin() + 4, result.begin() + 21);

    return result;
  }
};



std::vector<uint8_t> seed_from_phrase(std::string const& mnemonic) {
  // Prepare salt ("mnemonic" + optional passphrase)
  std::string const salt = "mnemonic";  // + passphrase;

  // Generate seed using PBKDF2-HMAC-SHA512
  std::vector<uint8_t> seed(64);  // 512 bits
  PKCS5_PBKDF2_HMAC(
    mnemonic.c_str(),  // Password = mnemonic sentence
    mnemonic.length(),
    reinterpret_cast<unsigned char const*>(salt.c_str()),
    salt.length(),
    2048,  // Iterations
    EVP_sha512(),  // Hash function
    seed.size(),
    seed.data()
  );
  return seed;
}


// Hash helper functions
std::vector<uint8_t> hmac_sha512(std::vector<uint8_t> const& key,
                                 std::vector<uint8_t> const& data) {
  std::vector<uint8_t> output(64); // SHA512 produces 64 bytes
  unsigned int length = 64;

  HMAC_CTX* ctx = HMAC_CTX_new();
  HMAC_Init_ex(ctx, key.data(), key.size(), EVP_sha512(), nullptr);
  HMAC_Update(ctx, data.data(), data.size());
  HMAC_Final(ctx, output.data(), &length);
  HMAC_CTX_free(ctx);

  return output;
}

std::vector<uint8_t> sha256(std::vector<uint8_t> const& input) {
  std::vector<uint8_t> output(SHA256_DIGEST_LENGTH);
  SHA256_CTX sha256;
  SHA256_Init(&sha256);
  SHA256_Update(&sha256, input.data(), input.size());
  SHA256_Final(output.data(), &sha256);
  return output;
}

std::vector<uint8_t> hash160(std::vector<uint8_t> const& input) {
  // SHA256 followed by RIPEMD160
  auto sha = sha256(input);

  std::vector<uint8_t> output(RIPEMD160_DIGEST_LENGTH);
  RIPEMD160_CTX ripemd160;
  RIPEMD160_Init(&ripemd160);
  RIPEMD160_Update(&ripemd160, sha.data(), sha.size());
  RIPEMD160_Final(output.data(), &ripemd160);
  return output;
}


char const* BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

template <typename T>
std::string encode_base58(T const& input) {
  // Count leading zeros
  size_t zeros = 0;
  while (zeros < input.size() && input[zeros] == 0) {
    zeros++;
  }

  // Convert to big integer representation
  std::vector<uint8_t> b;
  b.reserve(input.size() * 138 / 100 + 1); // Log(256)/Log(58) ≈ 1.38

  for (size_t i = zeros; i < input.size(); i++) {
    uint16_t carry = input[i];
    for (size_t j = 0; j < b.size(); j++) {
      carry += (uint16_t)b[j] << 8;
      b[j] = carry % 58;
      carry /= 58;
    }
    while (carry > 0) {
      b.push_back(carry % 58);
      carry /= 58;
    }
  }

  // Build the encoded string
  std::string result;
  result.reserve(zeros + b.size());

  // Add leading '1's for each leading zero byte
  result.append(zeros, '1');

  // Add the rest in reverse order
  for (auto it = b.rbegin(); it != b.rend(); ++it) {
    result += BASE58_CHARS[*it];
  }

  return result;
}

LegacyBtcAddr decode_base58(std::string const& input) {
  LegacyBtcAddr result{};

  // Convert to big integer representation
  std::vector<uint16_t> bn;
  for (char c : input) {
    char const* pos = strchr(BASE58_CHARS, c);
    if (pos == nullptr) {
      throw std::runtime_error("Invalid base58 character");
    }
    uint16_t digit = pos - BASE58_CHARS;

    for (size_t i = 0; i < bn.size(); i++) {
      uint32_t carry = ((uint32_t)bn[i] * 58 + digit);
      bn[i] = carry & 0xff;
      digit = carry >> 8;
    }
    if (digit > 0) {
      bn.push_back(digit);
    }
  }

  // Add leading zeros
  size_t pos = 0;
  for (size_t i = 0; i < input.length() && input[i] == '1' && pos < result.size(); i++) {
    result[pos++] = 0;
  }
  // Convert to bytes
  for (auto it = bn.rbegin(); it != bn.rend() && pos < result.size(); ++it) {
    result[pos++] = *it;
  }

  if (pos != result.size()) {
    throw std::runtime_error("Invalid address length after decode");
  }

  return result;
}


bool check_seed_phrase(std::string const& mnemonic,
                       LegacyBtcAddr const& target_address) {
  // Convert indices to seed
  auto const seed = seed_from_phrase(mnemonic);

  // Generate master key
  HDKey const master_key = HDKey::from_seed(seed);

  // Check common derivation paths
  // Purpose, Coin type
  std::vector<std::vector<uint32_t>> const paths = {
      {44 | 0x80000000, 0 | 0x80000000}, // BIP44
      {49 | 0x80000000, 0 | 0x80000000}, // BIP49
      {84 | 0x80000000, 0 | 0x80000000}, // BIP84
      {},                                // Legacy
  };

  // For each path
  for (auto const& path : paths) {
    // Derive path
    HDKey key = master_key;
    for (uint32_t index : path) {
      key = key.derive_child(index);
    }
    // Check first N accounts
    bool const is_legacy = path.size() == 0;
    for (uint32_t i = 0; i < (is_legacy ? 1 : 20); ++i) {
      // 1 = change address
      for (uint32_t j = 0; j < 2; ++j) {
        // Check N account indices
        for (uint32_t k = 0; k < 20; ++k) {
          HDKey address_key =
            (is_legacy ? key : key.derive_child(0x80000000 | i))
            .derive_child(j).derive_child(k);
          if (false) {
            std::cout << "Testing: " << mnemonic;
            for (auto path_part : path) {
              std::cout << "/" << path_part;
            }
            if (!is_legacy) {
              std::cout << "/" << i;
            }
            std::cout << "/" << j << "/" << k << std::endl;
            auto const address = address_key.get_address();
            std::cout << "Got: " << encode_base58(address) << std::endl;
          }
          if (address_key.get_address() == target_address) {
            std::cout << mnemonic;
            for (auto path_part : path) {
              std::cout << "/" << path_part;
            }
            if (!is_legacy) {
              std::cout << "/" << i;
            }
            std::cout << "/" << j << "/" << k << std::endl;
            return true;
          }
        }
      }
    }
  }

  return false;
}


int main() {
  ctx = secp256k1_context_create(
    SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
  if (ctx == nullptr) {
    std::cerr << "Failed to create secp256k1 context" << std::endl;
    return 1;
  }

  std::string const mnemonic = (
    // --- test ---
    // "flame "
    // "property "
    // "favorite "
    // "scheme "
    // "guilt "
    // "proud "
    // "remove "
    // "device "
    // "room "
    // "coach "
    // "matter "
    // "mind"
    // --- real ---
    "rescue "
    "account "
    "rookie "
    "remember "
    "dose "
    "ice "
    "donor "
    "organ "
    "head "
    "eyebrow "
    "obvious "
    "seven"
  );
  LegacyBtcAddr target_bytes = decode_base58(
    // "1BB87kPvx5Nkm65RruKjV2dCJ8WPkujiwj"  // test
    // "1E7VCU26cP8MpiLbxUAKd5sQ1iMSfsJdmm"  // expected
    "1Lme4nrYHRChHwrpVHJTajEXGQjZv72GyS"  // wanted
  );
  assert(target_bytes[0] == 0);

  bool found = check_seed_phrase(mnemonic, target_bytes);

  secp256k1_context_destroy(ctx);

  return found ? 0 : 1;
}
