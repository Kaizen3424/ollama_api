export interface ChatCompletionRequest {
  model: string
  messages: ChatCompletionMessage[]
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: string | string[]
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
  response_format?: ResponseFormat
  tools?: Tool[]
  tool_choice?: string | ToolChoice
  n?: number
  user?: string
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  name?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type ContentPart = TextContentPart | ImageContentPart

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'low' | 'high' | 'auto'
  }
}

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema'
  json_schema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

export interface Tool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

export interface ToolChoice {
  type: 'function'
  function: { name: string }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Choice[]
  usage?: Usage
}

export interface Choice {
  index: number
  message: ChatCompletionMessage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: ChunkChoice[]
  usage?: Usage
}

export interface ChunkChoice {
  index: number
  delta: {
    role?: 'assistant'
    content?: string | null
    tool_calls?: ToolCallDelta[]
  }
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export interface ToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

export interface ModelListResponse {
  object: 'list'
  data: ModelInfo[]
}

export interface ModelInfo {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface ApiError {
  error: {
    message: string
    type: string
    code: string
  }
}
