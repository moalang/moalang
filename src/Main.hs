module Main where

import Debug.Trace (trace)
import Control.Applicative ((<|>), (<$>))
import Control.Monad (unless, guard)
import Control.Monad.State (StateT, runStateT, lift, get, put)
import System.Environment (getArgs)
import System.IO (isEOF)

-- Entry point
main = do
  args <- getArgs
  case args of
    ["test"] -> test
    (expr:_) -> putStrLn $ run expr
    _ -> repl

repl :: IO ()
repl = do
  putStr "> "
  v <- isEOF
  unless v $ do
    cmd <- getLine
    case cmd of
      "quit" -> return ()
      "exit" -> return ()
      "q" -> return ()
      _ -> do
        putStrLn $ run cmd
        repl

test :: IO ()
test = go
  where
    go = do
      read "true"
      read "false"
      read "1"
      read "123"
      read "\"hello\""
      read "a -> 1"
      read "[]"
      read "[\"hello\"]"
      read "[true false]"
      read "[1 2 3]"
      read "vector2: x int, y int"
      read "bool: true | false"
      read "name"
      read "func(1 true)"
      read "f = 1; f"
      read "vector1: x int; vector1(1)"
      read "a.b"
      read "a.b.c(1).d(2 e.f(3))"
      read $ string_join "\n| " ["num", "1 = a", "2 = b", "_ = c"]
      stmt "5" "2 + 3"
      stmt "-1" "2 - 3"
      stmt "6" "2 * 3"
      stmt "2" "7 // 3"
      stmt "1" "a = 1; a"
      stmt "1" "a = 1; b = a; b"
      stmt "3" "add a b = a + b; add(1 2)"
      stmt "[1 2 3]" "[1 1+1 3]"
      stmt "3" "vector2: x int, y int; v = vector2(1 2); v.x + v.y"
      stmt "a" "ab: a | b; a"
      stmt "b" "ab: a | b; b"
      stmt "10" "a = 1; a\n| 1 = 10\n| _ = 20"
      stmt "20" "a = 2; a\n| 1 = 10\n| _ = 20"
      putStrLn "done"
    read expr = putStrLn $ eq expr (to_string $ parse expr)
    stmt expect expr = putStrLn $ eq expect (run expr)
    eq a b = if a == b then ("ok: " ++ a) else ("ERROR: " ++ b)

run :: String -> String
run = to_string . eval . parse

-- Parser and Evaluator
type Env = [(String, AST)]
type Attrs = [(String, String)]
type Branches = [(AST, AST)]
data AST = Void
  | Int Int
  | String String
  | Bool Bool
  | Func [String] AST -- captures, arguments, body
  | Closure Env AST -- captures, body
  | Array [AST]
  | Def String AST
  | Class String Attrs -- type name, members
  | Instance String Env -- type name, members
  | Enum String Env -- type name, members
  | Op2 String AST AST
  | Ref String
  | Member AST String
  | Apply AST [AST]
  | Seq [AST]
  | Fork AST Branches -- target, branches
  deriving (Show, Eq)

string_join glue [] = ""
string_join glue xs = drop (length glue) $ foldr (\l r -> r ++ glue ++ l) "" (reverse xs)

to_string (Int n) = show n
to_string (String s) = show s
to_string (Bool True) = "true"
to_string (Bool False) = "false"
to_string (Func args body) = (string_join "," args) ++ " -> " ++ (to_string body)
to_string (Closure env body) = (string_join "," (map fst env)) ++ " -> " ++ (to_string body)
to_string (Array xs) = "[" ++ string_join " " (map to_string xs) ++ "]"
to_string (Def name x@(Class _ attrs)) = name ++ ": " ++ attrs_string attrs
to_string (Def name x@(Enum _ attrs)) = name ++ ": " ++ enum_string name attrs
to_string (Def name x) = name ++ " = " ++ to_string x
to_string (Class name _) = name
to_string (Enum name _) = name
to_string (Op2 op l r) = squash_strings [to_string l, op, to_string r]
to_string (Ref id) = id
to_string (Member ast member) = to_string ast ++ "." ++ member
to_string (Apply self args) = to_string self ++ "(" ++ (squash_strings $ map to_string args) ++ ")"
to_string (Seq xs) = string_join "; " $ map to_string xs
to_string (Instance name []) = name
to_string (Instance name xs) = name ++ "(" ++ (env_string xs) ++ ")"
to_string (Fork target branches) = (to_string target) ++ foldr show_branch "" branches
  where
    show_branch (cond, body) acc = "\n| " ++ to_string cond ++ " = " ++ to_string body ++ acc
to_string e = error $ show e
attrs_string attrs = string_join ", " $ map (\(k, a) -> squash_strings [k, a]) attrs
enum_string prefix xs = string_join " | " (map (\(k, v) -> squash_strings [drop (1 + length prefix) k, to_string v]) xs)
env_string env = string_join ", " $ map (\(k, v) -> squash_strings [k, to_string v]) env
squash_strings :: [String] -> String
squash_strings [] = ""
squash_strings ("":zs) = squash_strings zs
squash_strings (" ":zs) = squash_strings zs
squash_strings (x:"":zs) = squash_strings (x : zs)
squash_strings (x:" ":zs) = squash_strings (x : zs)
squash_strings (x:y:zs) = x ++ " " ++ y ++ (squash_strings zs)
squash_strings [x] = x

-- Parser
data Source = Source { src :: String, pos :: Int } deriving Show
type Parser a = StateT Source Maybe a

parse :: String -> AST
parse input = go
  where
    go = case runStateT parse_top (Source input 0) of
      Nothing -> error $ "parse error: " ++ input
      Just (ast, s) -> case length (src s) == pos s of
        True -> ast
        False -> error $ "Remaining: " ++ drop (pos s) (src s)
    parse_top :: Parser AST
    parse_top = between spaces spaces parse_lines
      where
        parse_lines = make_seq <$> sepBy (read_br) parse_line
        parse_line = parse_def `or` parse_exp_or_fork
        parse_def = do
          id <- read_id
          args <- read_args
          mark <- read_any ":="
          body <- case mark of
            ':' -> (parse_class id) `or` (parse_enum id) `or` (die "body in parse_def")
            '=' -> parse_exp
          return $ Def id (make_func args body)
        parse_class name = Class name <$> read_kvs1
        parse_enum name = Enum name <$> read_enums1
        parse_exp_or_fork = do
          exp <- parse_exp
          (parse_fork exp) `or` (return exp)
        parse_fork exp = Fork exp <$> many1 parse_branch
        parse_branch = do
          satisfy (== '\n')
          satisfy (== '|')
          cond <- parse_unit
          read_char '='
          body <- parse_exp
          return (cond, body)
    parse_exp = do
      l <- parse_unit
      parse_op2 l `or` (return l)
    parse_op2 left = do
      op <- read_op
      right <- parse_exp
      return $ Op2 op left right
    parse_unit = parse_bool `or`
                 parse_int `or`
                 parse_string `or`
                 parse_array `or`
                 parse_closure `or`
                 parse_apply
      where
        parse_apply :: Parser AST
        parse_apply = parse_ref >>= go
          where
            go :: AST -> Parser AST
            go node = option node $ _go node
            _go :: AST -> Parser AST
            _go node = do
              mark <- satisfy $ \x -> elem x ".("
              case mark of
                '.' -> (Member node <$> get_id) >>= go
                '(' -> do
                  args <- many parse_exp
                  read_char ')'
                  go $ make_apply node args
        parse_ref = Ref <$> read_id
        parse_bool = Bool <$> fmap (== "true") (read_strings ["true", "false"])
        parse_int = Int <$> fmap read read_int
        parse_string = String <$> between (char '"') (char '"') (many $ satisfy (/= '"'))
        parse_array = Array <$> between (char '[') (char ']') (many parse_exp)
        parse_closure = do
          args <- read_args
          read_string "->"
          body <- parse_exp
          return $ Func args body

    make_func [] body = body
    make_func args body = Func args body
    make_apply node [] = node
    make_apply node args = Apply node args
    make_seq [x] = x
    make_seq xs = Seq xs

    read_enums1 = sepBy2 (read_char '|') read_enum
    read_enum = do
      k <- read_id
      v <- read_kvs
      return (k, Class k v)
    read_kvs = sepBy (read_char ',') read_kv
    read_kvs1 = sepBy1 (read_char ',') read_kv
    read_kv = do
      k <- read_id
      v <- read_type
      return (k, v)
    read_args = many read_id
    read_type = read_id
    read_id = lex get_id
    read_ids1 = sepBy1 (satisfy (== '.')) read_id
    read_int = lex $ many1 $ get_any "0123456789"
    read_strings (x:xs) = foldr or (read_string x) (map read_string xs)
    read_string s = lex $ mapM_ (\x -> satisfy (== x)) s >> return s
    read_char c = lex $ satisfy (== c)
    read_op = read_strings ["+", "-", "*", "//"]
    read_br = read_strings [";", ",", "\n"]
    read_any s = lex $ get_any s
    get_any s = satisfy (\x -> elem x s)
    get_id = many1 $ get_any "abcdefghijklmnopqrstuvwxyz0123456789_"

    option alt main = main `or` (return alt)
    or l r = do
      s <- get
      l <|> (put s >> r)

    lex f = (many $ satisfy (== ' ')) >> f
    indent f = do
      read_string "  "
      v <- f
      read_string "\n"
      return v
    spaces = many $ read_any "\n\t "
    sepBy sep f = (sepBy1 sep f) `or` (return [])
    sepBy1 sep f = do
      x <- f
      xs <- many (sep >> f)
      return $ x : xs
    sepBy2 sep f = do
      x <- f
      xs <- many1 (sep >> f)
      return $ x : xs
    char c = satisfy (== c)
    between l r m = do
      l
      v <- m -- `or` (die $ "missing body in " ++ show l ++ show r)
      r `or` (die $ "Does not close in between")
      return v
    many1 f = do
      x <- f
      xs <- many f
      return $ x : xs
    many f = go []
      where
        go acc = (next acc) `or` (return $ reverse acc)
        next acc = do
          x <- f
          go (x : acc)
    satisfy :: (Char -> Bool) -> Parser Char
    satisfy f = do
      s <- get
      guard $ (pos s) < (length $ src s)
      let c = (src s) !! (pos s)
      guard $ f c
      put (s { pos = (pos s) + 1 })
      return c
    die message = trace message (return ()) >> dump >> error message
    dump :: Parser ()
    dump = do
      s <- get
      trace ("die: " ++ show s ++ " @ " ++ (show $ drop (pos s) (src s))) (return ())


-- Evaluator
eval :: AST -> AST
eval x = top [] x
  where
    top :: Env -> AST -> AST
    top env (Seq xs) = go env xs
      where
        go :: Env -> [AST] -> AST
        go env [] = snd $ head env
        go env ((Def name (Enum _ env2)):ys) = go (env2 ++ env) ys
        go env ((Def name body):ys) = go ((name, top env body) : env) ys
        go env (y:ys) = go (("_", top env y) : env) ys
    top env x = go x
      where
        go (Ref name) = find name env
        go (Member target name) = case go target of
          (Instance _ env2) -> find name env2
          (Enum _ env2) -> find name env2
        go (Apply target argv) = case go target of
          (Func args body) -> top (zip args $ map go argv) body
          (Class name members) -> go $ Instance name (zip (map fst members) argv)
        go (Array xs) = Array $ map go xs
        go (Op2 op left right) = case (op, go left, go right) of
          ("+", (Int l), (Int r)) -> Int $ l + r
          ("-", (Int l), (Int r)) -> Int $ l - r
          ("*", (Int l), (Int r)) -> Int $ l * r
          ("//", (Int l), (Int r)) -> Int $ l `div` r
          x -> error $ "op2: " ++ show x
        go (Fork raw_target branches) = match branches
          where
            target = go raw_target
            match [] = error $ "Does not match target=" ++ show target ++ " branches=" ++ show branches
            match (((Ref "_"), body):_) = body
            match ((cond, body):xs) = if target == cond then body else match xs
        go x = x
        find :: String -> [(String, AST)] -> AST
        find k kvs = case lookup k kvs of
          Nothing -> error $ "not found " ++ k ++ " in " ++ string_join ", " (map fst kvs)
          Just y -> go y

-- TODO
--   x REPL
--   - for parser
--     x bool
--     x int
--     (skip) float
--     x string
--     x closure (func)
--     x array
--     (skip) dictionary
--     x struct
--     x enum
--     (skip) flow
--     x sequence
--     x branch
--     x binary operators
--     - embedded functions
--   - for evaluator
--     x bool
--     x int
--     (skip) float
--     x string
--     (skip) closure
--     x array
--     (skip) dictionary
--     x struct
--     x enum
--     (skip) flow
--     x sequence
--     x branch
--     x binary operators
--     - embedded functions
