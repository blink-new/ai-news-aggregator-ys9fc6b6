export interface NewsArticle {
  id: string
  title: string
  originalText: string
  translatedText: string
  summary: string
  publishedAt: string
  source: string
  url: string
  imageUrl?: string
}

export interface SearchResult {
  title: string
  snippet: string
  link: string
  source?: string
  date?: string
}