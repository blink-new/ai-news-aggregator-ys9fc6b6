import { useState, useEffect } from 'react'
import { blink } from '../blink/client'
import { NewsArticle, SearchResult } from '../types/news'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { Loader2 } from 'lucide-react'

export function NewsAggregator() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState(null)
  const [error, setError] = useState<string | null>(null)

  // Rate limiting helper function
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // Exponential backoff retry function
  const retryWithBackoff = async (fn: () => Promise<any>, maxRetries = 3, baseDelay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn()
      } catch (error: any) {
        if (error?.details?.code === 'RATE_LIMIT_EXCEEDED' && i < maxRetries - 1) {
          const waitTime = error?.details?.reset ? 
            new Date(error.details.reset).getTime() - Date.now() : 
            baseDelay * Math.pow(2, i)
          
          console.log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)} seconds...`)
          await delay(Math.max(waitTime, baseDelay * Math.pow(2, i)))
          continue
        }
        throw error
      }
    }
  }

  const fetchNews = async () => {
    setLoading(true)
    setError(null)
    try {
      console.log('ニュース取得を開始...')
      
      // Reduced to 2 optimized search queries to minimize API calls
      const searchQueries = [
        'AI 人工知能 最新ニュース 2024 OpenAI ChatGPT',
        'generative AI 生成AI 最新技術 Google Microsoft'
      ]

      const allResults: any[] = []

      // Sequential search with delays to avoid rate limiting
      for (let i = 0; i < searchQueries.length; i++) {
        const query = searchQueries[i]
        try {
          console.log(`検索中 (${i + 1}/${searchQueries.length}): ${query}`)
          
          // Try news search first with retry logic
          const newsResults = await retryWithBackoff(async () => {
            return await blink.data.search(query, {
              type: 'news',
              limit: 8 // Increased limit per query since we have fewer queries
            })
          })

          if (newsResults.news_results && newsResults.news_results.length > 0) {
            allResults.push(...newsResults.news_results)
            console.log(`ニュース検索結果: ${newsResults.news_results.length}件`)
          }

          // Add delay between searches
          if (i < searchQueries.length - 1) {
            await delay(2000) // 2 second delay between searches
          }

        } catch (searchError) {
          console.log(`検索エラー (${query}):`, searchError)
        }
      }

      console.log('全検索結果数:', allResults.length)

      // Remove duplicates based on URL
      const uniqueResults = allResults.filter((result, index, self) => 
        index === self.findIndex(r => r.link === result.link)
      )

      console.log('重複除去後:', uniqueResults.length)

      const processedArticles: NewsArticle[] = []

      // Process maximum 6 articles to reduce API calls
      const maxArticles = Math.min(6, uniqueResults.length)
      
      for (let i = 0; i < maxArticles; i++) {
        const result = uniqueResults[i]
        
        try {
          console.log(`記事 ${i + 1}/${maxArticles} 処理中: ${result.title}`)
          
          // Use snippet/description as content to avoid content extraction API calls
          let fullContent = result.snippet || result.description || ''
          
          // Only extract content if snippet is too short and we have budget for API calls
          if (fullContent.length < 200 && i < 3) { // Only extract for first 3 articles
            try {
              console.log(`記事内容を抽出中: ${result.link}`)
              const extractedContent = await retryWithBackoff(async () => {
                return await blink.data.extractFromUrl(result.link)
              })
              
              if (extractedContent && extractedContent.length > 200) {
                fullContent = extractedContent.substring(0, 2000) // Reduced max length
                console.log(`記事内容抽出成功: ${fullContent.length}文字`)
              }
            } catch (extractError) {
              console.log(`記事抽出失敗 (${result.link}):`, extractError)
            }
          }

          // Generate translation only if we have sufficient content
          let translatedText = ''
          
          if (fullContent && fullContent.length > 50) {
            try {
              console.log('日本語翻訳を生成中...')
              
              // Add delay before AI call to respect rate limits
              await delay(1500)
              
              const translation = await retryWithBackoff(async () => {
                return await blink.ai.generateText({
                  prompt: `以下のテキストを自然な日本語に翻訳してください。要約や省略はせず、元の内容をそのまま翻訳してください。既に日本語の場合はそのまま返してください。\n\nテキスト:\n${fullContent}\n\n翻訳:`,
                  maxTokens: 1000 // Reduced token limit
                })
              })
              
              translatedText = translation.text
              console.log('翻訳完了')
            } catch (translateError) {
              console.log('翻訳エラー:', translateError)
              translatedText = '翻訳に失敗しました'
            }
          }

          const article: NewsArticle = {
            id: `article-${Date.now()}-${i}`,
            title: result.title,
            originalText: fullContent,
            translatedText: translatedText,
            summary: '',
            publishedAt: result.date || new Date().toISOString(),
            source: result.source || result.displayed_link || 'Web',
            url: result.link,
            imageUrl: result.thumbnail || undefined
          }

          processedArticles.push(article)
          console.log(`記事 ${i + 1} 処理完了`)
          
          // Add delay between article processing
          if (i < maxArticles - 1) {
            await delay(2000) // 2 second delay between articles
          }
          
        } catch (error) {
          console.error(`記事処理エラー (${result.title}):`, error)
        }
      }

      setArticles(processedArticles)
      console.log('全処理完了。記事数:', processedArticles.length)
      
    } catch (error) {
      console.error('ニュース取得エラー:', error)
      setError(`ニュース取得に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`)
      
      // Show sample data on error
      const sampleArticles: NewsArticle[] = [
        {
          id: 'sample-1',
          title: 'OpenAI Releases GPT-4 Turbo with Enhanced Capabilities and Reduced Costs',
          originalText: `OpenAI has announced the release of GPT-4 Turbo, a significant update to their flagship language model that promises enhanced reasoning capabilities and substantially reduced costs for developers and businesses.

The new model features improved performance across multiple domains, including better code generation, mathematical reasoning, and creative writing. According to OpenAI's internal benchmarks, GPT-4 Turbo shows a 25% improvement in complex reasoning tasks compared to its predecessor.

Key improvements include:
- Enhanced context window supporting up to 128,000 tokens
- Reduced API pricing by 50% for input tokens and 25% for output tokens
- Improved instruction following and reduced hallucinations
- Better performance on coding tasks and technical documentation
- Enhanced multilingual capabilities

The model is now available through OpenAI's API with immediate access for existing customers. Enterprise customers will receive priority access to the new features, including advanced fine-tuning capabilities and dedicated compute resources.`,
          translatedText: `OpenAIは、主力言語モデルの大幅なアップデートであるGPT-4 Turboのリリースを発表しました。このモデルは、推論能力の向上と開発者・企業向けのコスト大幅削減を約束しています。

新しいモデルは、より良いコード生成、数学的推論、創作文章など、複数の領域でパフォーマンスが向上しています。OpenAIの内部ベンチマークによると、GPT-4 Turboは前モデルと比較して複雑な推論タスクで25%の改善を示しています。

主な改善点：
- 最大128,000トークンをサポートする拡張されたコンテキストウィンドウ
- 入力トークンで50%、出力トークンで25%のAPI価格削減
- 指示追従の改善と幻覚の減少
- コーディングタスクと技術文書でのパフォーマンス向上
- 多言語機能の強化

このモデルは現在、OpenAIのAPIを通じて既存顧客に即座にアクセス可能です。エンタープライズ顧客は、高度なファインチューニング機能や専用計算リソースを含む新機能への優先アクセスを受けられます。`,
          summary: '',
          publishedAt: new Date().toISOString(),
          source: 'OpenAI Blog',
          url: 'https://openai.com/blog/gpt-4-turbo'
        },
        {
          id: 'sample-2',
          title: 'Google Announces Gemini 2.0 with Multimodal AI Capabilities',
          originalText: `Google has unveiled Gemini 2.0, its most advanced AI model yet, featuring groundbreaking multimodal capabilities that can process text, images, audio, and video simultaneously. The new model represents a significant leap forward in AI technology and sets new benchmarks for performance across various tasks.

Gemini 2.0 introduces several revolutionary features:
- Native multimodal understanding without separate processing pipelines
- Real-time video analysis and generation capabilities
- Advanced reasoning across different media types
- Improved safety measures and alignment protocols
- Enhanced efficiency with reduced computational requirements

The model has been integrated into Google's suite of products, including Search, Assistant, and Workspace applications. Early testing shows remarkable improvements in complex reasoning tasks, with the model demonstrating human-level performance in many areas.

"Gemini 2.0 represents our vision of AI that truly understands the world as humans do," said Sundar Pichai, CEO of Google. "This is not just about processing different types of data, but about creating genuine understanding across modalities."`,
          translatedText: `Googleは、テキスト、画像、音声、動画を同時に処理できる画期的なマルチモーダル機能を特徴とする最も高度なAIモデル、Gemini 2.0を発表しました。この新しいモデルはAI技術における大きな飛躍を表し、様々なタスクでパフォーマンスの新しいベンチマークを設定しています。

Gemini 2.0はいくつかの革新的な機能を導入しています：
- 別々の処理パイプラインを必要としないネイティブマルチモーダル理解
- リアルタイム動画分析と生成機能
- 異なるメディアタイプ間での高度な推論
- 改善された安全対策と整合プロトコル
- 計算要件を削減した効率性の向上

このモデルは、検索、アシスタント、Workspaceアプリケーションを含むGoogleの製品スイートに統合されています。初期テストでは複雑な推論タスクで顕著な改善が示され、多くの分野で人間レベルのパフォーマンスを実証しています。

「Gemini 2.0は、人間と同じように世界を真に理解するAIという我々のビジョンを表しています」と、GoogleのCEOであるサンダー・ピチャイは述べました。「これは単に異なるタイプのデータを処理することではなく、モダリティ間での真の理解を創造することです。」`,
          summary: '',
          publishedAt: new Date().toISOString(),
          source: 'Google AI Blog',
          url: 'https://ai.googleblog.com/gemini-2-0'
        },
        {
          id: 'sample-3',
          title: 'Microsoft Copilot Gets Major Update with Advanced AI Reasoning',
          originalText: `Microsoft has announced a significant update to its Copilot AI assistant, introducing advanced reasoning capabilities that promise to transform how users interact with AI-powered productivity tools. The update brings enhanced problem-solving abilities and more sophisticated understanding of complex tasks.

The new reasoning engine can now handle multi-step problems, analyze complex data relationships, and provide detailed explanations for its recommendations. This represents a major leap forward from previous versions that primarily focused on text generation and basic task automation.

Enhanced capabilities include:
- Advanced mathematical and logical reasoning
- Complex data analysis and visualization suggestions
- Multi-document synthesis and comparison
- Improved code debugging and optimization recommendations
- Enhanced natural language understanding for technical queries

The update also introduces a new "Reasoning Mode" that allows users to see the AI's thought process step-by-step. This transparency feature helps users understand how Copilot arrives at its conclusions and builds trust in AI-generated recommendations.`,
          translatedText: `Microsoftは、AI搭載生産性ツールとのユーザーインタラクションを変革することを約束する高度な推論機能を導入し、CopilotAIアシスタントの大幅なアップデートを発表しました。このアップデートは、強化された問題解決能力と複雑なタスクのより洗練された理解をもたらします。

新しい推論エンジンは、多段階の問題を処理し、複雑なデータ関係を分析し、その推薦事項について詳細な説明を提供できるようになりました。これは、主にテキスト生成と基本的なタスク自動化に焦点を当てていた以前のバージョンからの大きな飛躍を表しています。

強化された機能：
- 高度な数学的・論理的推論
- 複雑なデータ分析と可視化提案
- 複数文書の統合と比較
- 改善されたコードデバッグと最適化推薦
- 技術的クエリに対する強化された自然言語理解

このアップデートでは、ユーザーがAIの思考プロセスを段階的に確認できる新しい「推論モード」も導入されています。この透明性機能は、ユーザーがCopilotがどのように結論に到達するかを理解し、AI生成の推薦事項への信頼を構築するのに役立ちます。`,
          summary: '',
          publishedAt: new Date().toISOString(),
          source: 'Microsoft News',
          url: 'https://news.microsoft.com/copilot-reasoning-update'
        }
      ]
      setArticles(sampleArticles)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (state.user && !state.isLoading) {
        fetchNews()
      }
    })
    return unsubscribe
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-black mb-4">生成AI最新情報</h1>
          <p className="text-gray-600">ログインしてニュースを表示します</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-black mb-2">生成AI最新情報</h1>
          <p className="text-gray-600">最新の生成AI技術ニュースと情報</p>
        </div>

        {/* 更新ボタン */}
        <div className="text-center mb-8">
          <Button
            onClick={fetchNews}
            disabled={loading}
            variant="outline"
            className="border-black text-black hover:bg-gray-50"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                読み込み中...
              </>
            ) : (
              '再読み込み'
            )}
          </Button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800 text-sm">{error}</p>
            <p className="text-red-600 text-xs mt-1">サンプルデータを表示しています</p>
          </div>
        )}

        {/* ニュース記事一覧 */}
        <div className="space-y-8">
          {articles.map((article, index) => (
            <div key={article.id}>
              <article className="space-y-4">
                {/* タイトル */}
                <h2 className="text-xl font-bold text-black leading-tight">
                  <a 
                    href={article.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {article.title}
                  </a>
                </h2>

                {/* ソースと日付 */}
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span>{article.source}</span>
                  <span>•</span>
                  <span>{new Date(article.publishedAt).toLocaleDateString('ja-JP')}</span>
                  <span>•</span>
                  <a 
                    href={article.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    元記事を読む
                  </a>
                </div>

                {/* 記事画像 */}
                {article.imageUrl && (
                  <div className="my-4">
                    <img 
                      src={article.imageUrl} 
                      alt={article.title}
                      className="w-full max-w-md h-auto rounded-md border border-gray-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  </div>
                )}

                {/* 原文 */}
                <div className="space-y-3">
                  <h3 className="font-medium text-black text-lg">原文:</h3>
                  <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap text-sm">
                      {article.originalText}
                    </p>
                  </div>
                </div>

                {/* 日本語翻訳 */}
                <div className="space-y-3">
                  <h3 className="font-medium text-black text-lg">日本語翻訳:</h3>
                  <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
                    <div className="text-gray-800 leading-relaxed whitespace-pre-wrap text-sm">
                      {article.translatedText}
                    </div>
                  </div>
                </div>
              </article>

              {/* 区切り線 */}
              {index < articles.length - 1 && (
                <Separator className="mt-8 bg-gray-300" />
              )}
            </div>
          ))}
        </div>

        {/* 記事がない場合 */}
        {!loading && articles.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">「再読み込み」ボタンを押してニュースを取得してください</p>
          </div>
        )}
      </div>
    </div>
  )
}