export async function openExternalURL(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('A URL de autenticação retornada é inválida')
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    throw new Error('Não foi possível abrir o navegador para autenticação')
  }
}
