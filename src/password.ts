const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const ALL = `${LETTERS}${DIGITS}`;

export function passwordProblem(password: string): string | null {
  if (password.length < 12 || password.length > 128 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
    return "Mật khẩu cần từ 12 ký tự, có chữ và số";
  }
  return null;
}

export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (byte) => ALL[byte % ALL.length] ?? "a");
  chars[0] = LETTERS[bytes[0] % LETTERS.length] ?? "a";
  chars[1] = DIGITS[bytes[1] % DIGITS.length] ?? "7";
  return chars.join("");
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
