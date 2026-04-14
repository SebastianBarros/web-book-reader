// PDF support is intentionally disabled in this build.
export const makePDF = async () => {
    throw new Error('PDF files are not supported in this reader.')
}
