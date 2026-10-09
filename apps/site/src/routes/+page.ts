import {
	getFeatureMatrix,
	getFeatureModels,
	getFeaturePhone,
	getFeaturePhones,
} from "#lib/api/sources.remote.ts";

// In a load, a hovered phone link fetches its matrix; reading only `phone`, a requirement change reloads nothing.
export const load = async ({ url }) => {
	const [phones, models, phone] = await Promise.all([
		getFeaturePhones(),
		getFeatureModels(),
		getFeaturePhone({ phone: url.searchParams.get("phone") ?? undefined }),
	]);
	return { phones, models, matrix: phone === null ? null : await getFeatureMatrix(phone.code) };
};
