const LAST_BOOK_KEY = 'online-mobi-reader:last-book'

export function getLastBookId(): string | null {
  return localStorage.getItem(LAST_BOOK_KEY)
}

export function setLastBookId(id: string): void {
  localStorage.setItem(LAST_BOOK_KEY, id)
}
