#include <iostream>
#include <time.h>

class Error {};

int g() {
  throw Error();
  return 1;
}

int f() {
  return g();
}

int main() {
  auto t1 = clock();
  int i = 0;
  while (true) {
    i++;
    try {
      f();
    } catch(Error& e) {
      if ((double)(clock() - t1) / CLOCKS_PER_SEC >= 1) {
        break;
      }
    }
  }
  std::cout << i << std::endl;
  return 0;
}
