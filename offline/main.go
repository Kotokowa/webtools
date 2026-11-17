// Copyright (c) 2026 Kotokowa. MIT License.
package main

import (
 "crypto/ed25519"
 "crypto/sha256"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "io"
 "log"
 "net"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "runtime"
 "strings"
 "time"
)

var publicKey string
var website = "https://kotokowa.github.io/webtools/water-wave/"

func verify(root string) error {
 data, err := os.ReadFile(filepath.Join(root,"provenance.json")); if err != nil { return err }
 sigText, err := os.ReadFile(filepath.Join(root,"provenance.sig")); if err != nil { return err }
 key, err := base64.StdEncoding.DecodeString(publicKey); if err != nil || len(key)!=ed25519.PublicKeySize { return fmt.Errorf("invalid publisher key") }
 sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigText))); if err != nil { return err }
 if !ed25519.Verify(key,data,sig) { return fmt.Errorf("publisher signature mismatch") }
 var manifest struct { Author string `json:"author"`; Website string `json:"website"`; Files map[string]string `json:"files"` }
 if err=json.Unmarshal(data,&manifest);err!=nil{return err}
 if manifest.Author!="kotokowa" || manifest.Website!=website {return fmt.Errorf("publisher metadata mismatch")}
 for name,want:=range manifest.Files {
  path:=filepath.Join(root,filepath.FromSlash(name)); rel,e:=filepath.Rel(root,path)
  if e!=nil || strings.HasPrefix(rel,"..") || filepath.IsAbs(rel) {return fmt.Errorf("invalid manifest path")}
  f,e:=os.Open(path);if e!=nil{return e};h:=sha256.New();_,e=io.Copy(h,f);f.Close();if e!=nil{return e}
  if hex.EncodeToString(h.Sum(nil))!=want{return fmt.Errorf("modified file: %s",name)}
 }
 return nil
}

func main() {
 exe,err:=os.Executable();if err!=nil{log.Fatal(err)};root:=filepath.Dir(exe)
 // Source is MIT-licensed; verification reports provenance, not a usage lock.
 integrity:="verified";if err=verify(root);err!=nil{integrity="modified: "+err.Error();log.Print(integrity)}
 listener,err:=net.Listen("tcp","127.0.0.1:0");if err!=nil{log.Fatal(err)}
 host:=listener.Addr().String(); content:=filepath.Join(root,"tool")
 files:=http.FileServer(http.Dir(content))
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.Host!=host || (r.Method!="GET"&&r.Method!="HEAD"){http.Error(w,"Forbidden",403);return}
  w.Header().Set("X-Content-Type-Options","nosniff")
  w.Header().Set("Content-Security-Policy","default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' blob: data:")
  if r.URL.Path=="/offline-status"{w.Header().Set("Content-Type","application/json");json.NewEncoder(w).Encode(map[string]string{"author":"kotokowa","website":website,"integrity":integrity});return}
  if strings.Contains(r.URL.Path,"\\") {http.Error(w,"Forbidden",403);return}
  path:=filepath.Join(content,filepath.FromSlash(r.URL.Path))
  resolved,e:=filepath.EvalSymlinks(path);if e!=nil{http.NotFound(w,r);return};rel,e:=filepath.Rel(content,resolved)
  if e!=nil||rel==".."||strings.HasPrefix(rel,".."+string(filepath.Separator)){http.Error(w,"Forbidden",403);return}
  info,e:=os.Stat(resolved);if e!=nil{http.NotFound(w,r);return};if info.IsDir(){if _,e=os.Stat(filepath.Join(resolved,"index.html"));e!=nil{http.NotFound(w,r);return}}
  files.ServeHTTP(w,r)
 })
 url:="http://"+host+"/"
 if os.Getenv("WATERWAVE_NO_BROWSER")!="1"{
  var cmd *exec.Cmd
  switch runtime.GOOS{case "windows":cmd=exec.Command("rundll32","url.dll,FileProtocolHandler",url);case "darwin":cmd=exec.Command("open",url);default:cmd=exec.Command("xdg-open",url)}
  if err=cmd.Start();err!=nil{log.Print(err)}
 }
 fmt.Println(url)
 server:=&http.Server{Handler:handler,ReadHeaderTimeout:10*time.Second}
 log.Fatal(server.Serve(listener))
}
