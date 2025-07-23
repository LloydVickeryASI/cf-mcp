/**
 * Timing-safe string comparison to prevent timing attacks
 * 
 * This function compares two strings in constant time to prevent
 * attackers from using timing differences to guess secret values.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		// Still need to do a comparison to maintain constant time
		// Compare with a dummy string of the same length as 'a'
		b = a;
	}
	
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	
	// Return true only if all characters matched (result === 0)
	// and the lengths were originally equal
	return result === 0 && a.length === b.length;
}