module Main where

import Debug.Trace (trace)
import Control.Applicative ((<|>), (<$>))
import Control.Monad (unless, guard)
import Control.Monad.State (StateT, runStateT, lift, get, put, modify)
import System.Environment (getArgs)
import System.IO (isEOF)

-- Entry point
main = do
  args <- getArgs
  case args of
    ["repl"] -> repl
    ["test"] -> test
    ["compile"] -> compile
    _ -> help

help :: IO ()
help = do
  putStrLn "Usage: runghc Main.hs [command]"
  putStrLn "The commands are:"
  putStrLn "\trepl\tstart repl"
  putStrLn "\ttest\ttest itself"
  putStrLn "\tgo\tcompile to go"

compile :: IO ()
compile = do
  src <- getContents
  let (Seq list1) = parse src
  let list2 = list1 ++ [Apply (Ref "compile") [String src]]
  case eval (Seq list2) of
    (String s) -> putStrLn s
    x -> print x

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
      read "f = 1; 2"
      read "f = 1\ng = f\ng"
      read "f = 1\ng = f; f\ng"
      read "f = \"hello\""
      read "add a b = a + b"
      read "vector1: x int\nvector1(1)"
      read "table: values tuple(string int).array"
      read "counter: count int, incr = count += 1"
      read "a.b"
      read "a.b.c(1).d(2 e.f(3))"
      read "mix: a int, add b = a + b\nmix(1).add(2)"
      read $ string_join "\n| " ["num", "1 = a", "2 = b", "_ = c"]
      stmt "()" "()"
      stmt "5" "2 + 3"
      stmt "-1" "2 - 3"
      stmt "6" "2 * 3"
      stmt "2" "7 // 3"
      stmt "2" "a = 1; 2"
      --stmt "2" "3 - (2 - 1)"
      stmt "3" "add a b = a + b\nadd(1 2)"
      stmt "3" "add a b =\n  c = a + b\n  c\nadd(1 2)"
      stmt "1" "v = 1\nf x = x\nf(v)"
      stmt "[1 2 3]" "[1 1+1 3]"
      stmt "3" "vector2: x int, y int\nv = vector2(1 2)\nv.x + v.y"
      stmt "3" "vector2: x int, y int, sum = x + y\nvector2(1 2).sum"
      stmt "3" "vector2:\n  x int\n  y int\n  sum = x + y\nvector2(1 2).sum"
      stmt "ab.a" "ab: a | b\nab.a"
      stmt "ab.b" "ab: a | b\nab.b"
      stmt "ab.b" "ab:\n| a\n| b\nab.b"
      stmt "10" "a = 1\na\n| 1 = 10\n| _ = 20"
      stmt "20" "a = 2\na\n| 1 = 10\n| _ = 20"
      stmt "3" "counter: count int, incr = count += 1, twice = incr; incr\ncounter(1).twice"
      stmt "5" "counter: count int, incr = count += 1, twice = a <- incr; b <- incr; a + b\ncounter(1).twice"
      stmt "14" "counter:\n  count int\n  incr a = count += a\n  twice =\n    b <- incr(1)\n    c <- incr(1)\n    b + c\n  quad =\n    d <- twice\n    e <- twice\n    d + e\ncounter(1).quad"
      stmt "[\"1\" \"2\"]" "\"12\".to_array"
      stmt "3" "\"1\".to_int + 2"
      stmt "\"0\"" "0.to_string"
      stmt "[1 2]" "[1] ++ [2]"
      -- build-in functions
      stmt "1" "if(true 1 2)"
      stmt "2" "if(false 1 2)"
      stmt "()" "guard(true)"
      stmt "Error: guard is failed" "guard(false)"
      stmt "true" "[1].include(1)"
      stmt "false" "[1].include(2)"
      --stmt "[1 2]" "f x = if(x < 2 1 guard(false))\nloop x acc = y <- f(x)\n| loop((x -1) acc ++ [y])\n| acc\nloop(3)"
      putStrLn "done"
    read expr = eq expr (parse expr) expr
    stmt expect expr = eq expect (eval $ parse expr) expr
    eq a b src = putStrLn $ if a == to_string b then "ok: " ++ oneline a "" else "EXPECT: " ++ a ++ "\nFACT  : " ++ to_string b ++ "\nAST   : " ++ (show b) ++ "\nSRC   : " ++ (src)
    oneline "" acc = reverse acc
    oneline ('\n':xs) acc = oneline xs ('n' : '\\' : acc)
    oneline (x:xs) acc = oneline xs (x : acc)

run :: String -> String
run = to_string . eval . parse

-- Parser and Evaluator
type Env = [(String, AST)]
type Branches = [(AST, AST)]
data AST = Void
  | Int Int
  | String String
  | Bool Bool
  | Func [String] AST -- captures, arguments, body
  | Array [AST]
  | Def String AST
  | Class String Env Env -- type name, attributes, methods
  | Instance String Env -- type name, attributes + methods
  | Enum String Env -- type name, members
  | Op2 String AST AST
  | Ref String
  | Member AST String [AST] -- target, name, arguments
  | Apply AST [AST]
  | Seq [AST]
  | Fork AST Branches -- target, branches
  | Update Env AST
  | Type AST
  | Error String
  deriving (Show, Eq)

string_join glue [] = ""
string_join glue xs = drop (length glue) $ foldr (\l r -> r ++ glue ++ l) "" (reverse xs)

to_string x = go x
  where
    go (Int n) = show n
    go (String s) = show s
    go (Bool True) = "true"
    go (Bool False) = "false"
    go (Func args body) = (string_join "," args) ++ " -> " ++ (go body)
    go (Array xs) = "[" ++ string_join " " (map go xs) ++ "]"
    go (Def name x@(Class _ _ _)) = name ++ ": " ++ def_string x
    go (Def name x@(Enum _ attrs)) = name ++ ": " ++ enum_string attrs
    go (Def name x@(Func args body)) = name ++ " " ++ (string_join " " args) ++ " = " ++ to_string body
    go (Def name (Type x)) = name ++ " " ++ go x
    go (Def name x) = name ++ " = " ++ go x
    go (Class name _ _) = name
    go (Enum name _) = name
    go (Op2 op l r) = go l ++ " " ++ op ++ " " ++ go r
    go (Ref id) = id
    go (Member ast member []) = go ast ++ "." ++ member
    go (Member ast member args) = go ast ++ "." ++ member ++ "(" ++ (squash_strings $ map go args) ++ ")"
    go (Apply self args) = go self ++ "(" ++ (squash_strings $ map go args) ++ ")"
    go (Seq xs) = seq_join xs "" ""
    go (Instance name []) = name
    go (Instance name xs) = name ++ "(" ++ (env_string xs) ++ ")"
    go (Void) = "()"
    go (Error message) = "Error: " ++ message
    go (Fork target branches) = (go target) ++ foldr show_branch "" branches
    go e = error $ show e
    seq_join [] _ acc = acc
    seq_join (x@(Def name ast):xs) glue acc = seq_join xs "\n" (acc ++ glue ++ to_string x)
    seq_join (x:xs) glue acc = seq_join xs "; " (acc ++ glue ++ to_string x)
    show_branch (cond, body) acc = "\n| " ++ go cond ++ " = " ++ go body ++ acc
    def_string (Class _ attrs methods) = env_string $ attrs ++ methods
    enum_string xs = string_join " | " (map (\(k, x) -> squash_strings [k, def_string x]) xs)
    env_string env = string_join ", " $ map (\(k, v) -> go $ Def k v) env
    type_string (Type x) = to_string x
    type_string x = to_string x
    squash_strings :: [String] -> String
    squash_strings [] = ""
    squash_strings ("":zs) = squash_strings zs
    squash_strings (" ":zs) = squash_strings zs
    squash_strings (x:"":zs) = squash_strings (x : zs)
    squash_strings (x:" ":zs) = squash_strings (x : zs)
    squash_strings (x:y:zs) = x ++ " " ++ y ++ (squash_strings zs)
    squash_strings [x] = x

-- Parser
data Source = Source { src :: String, pos :: Int, depth :: Int } deriving Show
type Parser a = StateT Source Maybe a

parse :: String -> AST
parse input = go
  where
    go = case runStateT parse_top (Source input 0 0) of
      Nothing -> error $ "parse error: " ++ input
      Just (ast, s) -> case length (src s) == pos s of
        True -> ast
        False -> error $ unlines [
            "Expect   : " ++ (show $ length (src s))
          , "Fact     : " ++ (show $ pos s)
          , "Remaining: " ++ drop (pos s) (src s)
          ]
    parse_top :: Parser AST
    parse_top = between spaces spaces parse_lines
    parse_lines = make_seq <$> sepBy (read_br) parse_line
    parse_line = parse_def `or` parse_exp_or_fork
    parse_def = do
      id <- read_id
      args <- read_args
      mark <- read_any ":="
      body <- indent $ case mark of
        '=' -> parse_seq
        ':' -> (parse_enum id) `or` (parse_class id) `or` (die $ "invalid definition in parse_def for " ++ id)
      return $ Def id (make_func args body)
    parse_class name = do
      (attrs, methods) <- read_attrs_and_methods
      return $ Class name attrs methods
    parse_enum name = Enum name <$> read_enums1 (name ++ ".")
    parse_exp_or_fork = do
      exp <- parse_exp
      (parse_fork exp) `or` (return exp)
    parse_fork exp = Fork exp <$> many1 parse_branch
    parse_branch = do
      satisfy (== '\n')
      satisfy (== '|')
      cond <- parse_unit
      read_char '='
      body <- indent parse_seq
      return (cond, body)
    parse_seq = make_seq <$> (
                  (sepBy1 (read_char ';') parse_exp) `or`
                  (many1 (read_indent >> parse_line))
                  )
    parse_exp = do
      l <- parse_unit
      parse_op2 l `or` (return l)
    parse_op2 left = do
      op <- read_op
      right <- parse_exp
      return $ Op2 op left right
    parse_unit = parse_value >>= parse_apply
      where
        parse_value = parse_void `or`
                      parse_bool `or`
                      parse_int `or`
                      parse_string `or`
                      parse_array `or`
                      parse_closure `or`
                      parse_ref
        parse_void = read_string "()" >> return Void
        parse_apply node = option node $ parse_follow node
        parse_follow node = do
          mark <- satisfy $ \x -> elem x ".("
          case mark of
            '.' -> do
              id <- get_id
              argv <- option [] $ between (char '(') (read_char ')') $ many parse_exp
              parse_apply $ Member node id argv
            '(' -> do
              args <- many parse_exp
              read_char ')'
              parse_apply $ make_apply node args
        parse_ref = Ref <$> read_id
        parse_bool = Bool <$> fmap (== "true") (read_strings ["true", "false"])
        parse_int = Int <$> fmap read read_int
        parse_string = String <$> between (read_char '"') (char '"') (many $ satisfy (/= '"'))
        parse_array = Array <$> between (read_char '[') (char ']') (many parse_exp)
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

    read_enums1 prefix = go
      where
        go = enum_lines `or` enum_line
        enum_lines = many1 (read_string "\n|" >> read_enum prefix)
        enum_line = sepBy2 (read_char '|') $ read_enum prefix
        read_enum prefix = do
          id <- read_id
          (attrs, method) <- read_attrs_and_methods
          return (id, Class (prefix ++ id) attrs method)
    read_attrs_and_methods = go
      where
        go = fmap (split [] []) read_members
        split acc1 acc2 [] = (reverse acc1, reverse acc2)
        split acc1 acc2 (x@(_, Type _):xs) = split (x : acc1) acc2 xs
        split acc1 acc2 (x:xs) = split acc1 (x : acc2) xs
        read_members = (read_indent >> sepBy read_indent read_member) `or` sepBy (read_char ',') read_member
        read_member = read_member_method `or` read_member_attr
        read_member_method = do
          id <- read_id
          args <- read_args
          read_char '='
          body <- indent parse_seq
          return (id, make_func args body)
        read_member_attr = do
          id <- read_id
          t <- Type <$> parse_exp
          return (id, t)
    read_args = many read_id
    read_id = lex get_id
    read_ids1 = sepBy1 (satisfy (== '.')) read_id
    read_int = lex $ many1 $ get_any "0123456789"
    read_strings (x:xs) = foldl or (read_string x) (map read_string xs)
    read_string s = lex $ mapM_ (\x -> satisfy (== x)) s >> return s
    read_char c = lex $ satisfy (== c)
    read_op = read_strings [
              "<-",
              "==", "!=", ">=", "<=", ">", "<",
              "+=", "-=", "*=", "//=",
              "++",
              "+", "-", "*", "//"]
    read_br = read_strings [";", ",", "\n"]
    read_any s = lex $ get_any s
    read_indent = do
      s <- get
      let sp = take (2 * depth s) $ repeat ' '
      read_string $ "\n" ++ sp

    get_any s = satisfy (\x -> elem x s)
    get_id = many1 $ get_any "abcdefghijklmnopqrstuvwxyz0123456789_"

    option alt main = main `or` (return alt)
    or l r = do
      s <- get
      l <|> (put s >> r)
    lex f = (many $ satisfy (== ' ')) >> f
    indent :: Parser a -> Parser a
    indent f = do
      modify $ \s -> s { depth = depth s + 1 }
      ret <- f
      modify $ \s -> s { depth = depth s - 1 }
      return ret
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
    see :: Parser String
    see = do
      s <- get
      return $ if (pos s) < (length $ src s)
        then [(src s) !! (pos s)]
        else ""
    die message = trace message (return ()) >> dump >> error message
    dump :: Parser ()
    dump = do
      s <- get
      trace ("die: " ++ show s ++ " @ " ++ (show $ drop (pos s) (src s))) (return ())


-- Evaluator
eval :: AST -> AST
eval root = unwrap $ go [] root
  where
    unwrap x = case x of
      (Update _ body) -> body
      (Def _ body) -> body
      _ -> x
    go :: Env -> AST -> AST
    go env (Seq xs) = run_seq env [] xs
      where
        run_seq :: Env -> Env -> [AST] -> AST
        run_seq env [] [] = snd $ head env
        run_seq env eff [] = Update eff (snd $ head env)
        run_seq env eff ((Def name body):ys) = run_seq ((name, go env body) : env) eff ys
        run_seq env eff ((Op2 "<-" (Ref name) right):ys) = case go env right of
          (Update diff body) -> run_seq ((name, body) : diff ++ env) (diff ++ eff) ys
          body               -> run_seq ((name, body) : env) eff ys
        run_seq env eff ((Op2 "<-" l r):ys) = error "Invalid operation"
        run_seq env eff (y:ys) = case go env y of
          (Update diff body) -> run_seq (("_", body) : diff ++ env) (diff ++ eff) ys
          body -> run_seq (("_", body): env) eff ys
    go env (Def _ body) = go env body
    go env (Ref name) = go env $ find name env
    go env (Member target name argv) = exec_member env (go env target) name argv
    go env (Apply (Ref "guard") [x]) = buildin_guard (go env x)
    go env (Apply (Ref "if") [a, b, c]) = buildin_if env (go env a) b c
    go env (Apply target raw_argv) = apply env (go env target) $ map (go env) raw_argv
    go env (Array xs) = Array $ map (go env) xs
    go env (Op2 "+=" l@(Ref name) r) = update name $ operate env "+" l r
    go env (Op2 "-=" l@(Ref name) r) = update name $ operate env "-" l r
    go env (Op2 "*=" l@(Ref name) r) = update name $ operate env "*" l r
    go env (Op2 "//=" l@(Ref name) r) = update name $ operate env "//" l r
    go env (Op2 op l r) = operate env op l r
    go env (Fork raw_target branches) = match branches
      where
        target = go env raw_target
        match [] = error $ "Does not match target=" ++ show target ++ " branches=" ++ show branches
        match (((Ref "_"), body):_) = body
        match ((cond, body):xs) = if target == cond then body else match xs
    go _ x = x
    exec_member env (String s) "to_array" [] = Array $ map (\x -> String [x]) s
    exec_member env (String s) "to_int" [] = Int (read s :: Int)
    exec_member env (Int s) "to_string" [] = String (show s)
    exec_member env (Array xs) "include" [x] = Bool (elem x $ map (go env) xs)
    exec_member env (Instance _ env2) name [] = bind (env2 ++ env) name env2
    exec_member env (Enum _ env2) name [] = bind (env2 ++ env) name env2
    exec_member env (Func args body) _ argv = go ((zip args argv) ++ env) body
    exec_member env x name argv = error $ "Unexpect member " ++ name ++ " of " ++ show x ++ " with " ++ show argv
    apply env target argv = case (target, argv) of
      ((Func args body), _) -> go ((zip args $ map (go env) argv) ++ env) body
      ((Class name attrs methods), _) -> Instance name ((zip (map fst attrs) argv) ++ methods)
      ((String s), [Int x]) -> String $ [s !! x]
      x -> error $ "Unexpect target " ++ show x ++ " with " ++ show argv
    operate :: Env -> String -> AST -> AST -> AST
    operate env op left right = case (op, go env left, go env right) of
      ("++", (Array l), (Array r)) -> Array $ l ++ r
      ("+", (Int l), (Int r)) -> Int $ l + r
      ("-", (Int l), (Int r)) -> Int $ l - r
      ("*", (Int l), (Int r)) -> Int $ l * r
      ("//", (Int l), (Int r)) -> Int $ l `div` r
      x -> error $ "op2: " ++ show x
    update name body = Update [(name, body)] body
    find :: String -> Env -> AST
    find k kvs = case lookup k kvs of
      Nothing -> error $ "not found " ++ k ++ " in " ++ string_join ", " (map fst kvs)
      Just x -> x
    bind env k kvs = case go env $ find k kvs of
      (Func args body) -> Func args $ Apply (Func (map fst env) body) (map snd env)
      x -> x
    buildin_if env (Bool True) x _ = go env x
    buildin_if env (Bool False) _ x = go env x
    buildin_if env x _ _ = error $ "Invalid argument " ++ show x ++ " in build-in `if`"
    buildin_guard (Bool True) = Void
    buildin_guard (Bool False) = Error "guard is failed"
