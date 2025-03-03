package co.edu.uniquindio.Repaso.EstructurasDeControl;

import java.util.Scanner;

public class SwichtCase {
    public static void main(String[] args) {
        System.out.println("Ingrese un numero entero");
        Scanner sc= new Scanner(System.in);
        int num= sc.nextInt();
        int residuo= num %2;
        switch (residuo){
            case 0:
                System.out.println("El numero es par");
                break;
            default:
            case 1:
                System.out.printf("El numero es impar");
                break;
        }

    }
}
